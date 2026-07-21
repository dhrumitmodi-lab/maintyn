from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import io
import csv
import uuid
import secrets
import asyncio
import logging
import bcrypt
import jwt
import httpx
import requests
from datetime import datetime, timezone, timedelta, date as _date
from typing import Optional, List

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Form, Header, Query, BackgroundTasks
from fastapi.responses import Response as FastAPIResponse
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr, Field

# ---------- Config ----------
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
MASTER_DB_NAME = os.environ.get('MASTER_DB_NAME', 'maintyn_master')
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = "HS256"
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')
APP_NAME = os.environ.get('APP_NAME', 'maintyn')
STORAGE_URL = "https://integrations.emergentagent.com/objstore/api/v1/storage"
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMERGENT_EMAIL_KEY = os.environ.get('EMERGENT_EMAIL_KEY')
EMAIL_FROM_NAME = os.environ.get('EMAIL_FROM_NAME', 'maintyn')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

client = AsyncIOMotorClient(MONGO_URL)
master_db = client[MASTER_DB_NAME]

# Per-request tenant DB via ContextVar; existing code uses `db.<collection>` transparently.
from contextvars import ContextVar
_current_db: ContextVar = ContextVar("current_db", default=None)

def _db_name_for_society(society_id: str) -> str:
    return f"maintyn_society_{society_id.replace('-', '')}"

def _get_society_db(society_id: str):
    return client[_db_name_for_society(society_id)]

class _DBProxy:
    """Transparent proxy to the current-tenant Motor db held in a ContextVar.
    Falls back to the legacy DB_NAME db when no context is set (startup, workers)."""
    _fallback = client[DB_NAME]
    def _target(self):
        d = _current_db.get()
        return d if d is not None else self._fallback
    def __getattr__(self, name):
        return getattr(self._target(), name)
    def __getitem__(self, name):
        return self._target()[name]

db = _DBProxy()

app = FastAPI(title="Maintyn API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("maintyn")

# ---------- Storage ----------
_storage_key = None

def init_storage():
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_LLM_KEY:
        logger.warning("EMERGENT_LLM_KEY not set - uploads will fail")
        return None
    try:
        r = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
        r.raise_for_status()
        _storage_key = r.json()["storage_key"]
        return _storage_key
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
        return None

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(500, "Storage unavailable")
    r = requests.put(f"{STORAGE_URL}/objects/{path}",
                     headers={"X-Storage-Key": key, "Content-Type": content_type},
                     data=data, timeout=120)
    r.raise_for_status()
    return r.json()

def get_object(path: str):
    key = init_storage()
    if not key:
        raise HTTPException(500, "Storage unavailable")
    r = requests.get(f"{STORAGE_URL}/objects/{path}",
                     headers={"X-Storage-Key": key}, timeout=60)
    r.raise_for_status()
    return r.content, r.headers.get("Content-Type", "application/octet-stream")

# ---------- Email ----------
async def send_email_raw(to: str, subject: str, html: str):
    if not EMERGENT_EMAIL_KEY:
        logger.warning("EMERGENT_EMAIL_KEY not set - skipping email")
        return
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(f"{EMAIL_BASE_URL}/api/v1/email/send",
                                     headers={"X-Email-Key": EMERGENT_EMAIL_KEY},
                                     json=payload)
        if resp.status_code >= 400:
            logger.error(f"Email failed {resp.status_code}: {resp.text}")
        else:
            logger.info(f"Email sent to {to}: {subject}")
    except Exception as e:
        logger.error(f"Email exception: {e}")

def _email_frame(title: str, body_html: str, cta_url: Optional[str] = None, cta_text: Optional[str] = None) -> str:
    cta = ""
    if cta_url and cta_text:
        cta = (f'<p style="margin:24px 0"><a href="{cta_url}" '
               f'style="background:#C85A3C;color:#fff;text-decoration:none;padding:12px 24px;'
               f'border-radius:999px;font-family:Arial,sans-serif;font-weight:600;display:inline-block">'
               f'{cta_text}</a></p>')
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F6F4F1;padding:32px 12px;font-family:Arial,sans-serif;color:#1B3127">
      <tr><td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E2DFD8;border-radius:4px;padding:32px">
          <tr><td>
            <p style="margin:0 0 8px 0;letter-spacing:0.2em;font-size:11px;text-transform:uppercase;color:#576B61">maintyn · community os</p>
            <h1 style="margin:0 0 16px 0;font-size:24px;color:#1B3127">{title}</h1>
            <div style="font-size:15px;line-height:1.6;color:#1B3127">{body_html}</div>
            {cta}
            <p style="font-size:12px;color:#576B61;margin-top:24px">— Team maintyn</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
    """

# ---------- Password / JWT ----------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(user_id: str, email: str, role: str, kind: str = "society", society_id: Optional[str] = None) -> str:
    payload = {"sub": user_id, "email": email, "role": role, "kind": kind,
               "exp": datetime.now(timezone.utc) + timedelta(hours=12), "type": "access"}
    if society_id:
        payload["society_id"] = society_id
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def set_auth_cookies(resp: Response, access: str, refresh: str):
    resp.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    resp.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")

def clear_auth_cookies(resp: Response):
    resp.delete_cookie("access_token", path="/")
    resp.delete_cookie("refresh_token", path="/")

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        kind = payload.get("kind", "society")
        if kind == "master":
            mu = await master_db.master_users.find_one({"id": payload["sub"], "is_active": True})
            if not mu:
                raise HTTPException(401, "User not found")
            mu.pop("_id", None); mu.pop("password_hash", None)
            mu["kind"] = "master"
            return mu
        # society user — set tenant context so all `db.<coll>` calls hit the right DB
        sid = payload.get("society_id")
        if not sid:
            raise HTTPException(401, "Missing society context")
        soc = await master_db.societies.find_one({"id": sid})
        if not soc or soc.get("status") == "suspended":
            raise HTTPException(403, "Society is suspended or missing")
        _current_db.set(_get_society_db(sid))
        user = await db.users.find_one({"id": payload["sub"]})
        if not user:
            raise HTTPException(401, "User not found")
        user.pop("_id", None); user.pop("password_hash", None)
        user["society_id"] = sid
        user["kind"] = "society"
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

def require_roles(*roles):
    async def checker(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, "Insufficient permissions")
        return user
    return checker

require_staff = require_roles("admin", "committee")
require_admin = require_roles("admin")

# ---------- Models ----------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    phone: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    phone: Optional[str] = None
    role: str = "resident"  # admin, committee, resident
    flat_id: Optional[str] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    flat_id: Optional[str] = None
    password: Optional[str] = None

class FlatIn(BaseModel):
    block: str
    number: str
    floor: Optional[str] = None
    bhk: Optional[str] = None
    owner_id: Optional[str] = None
    tenant_id: Optional[str] = None
    occupancy: str = "vacant"  # owner, tenant, vacant

class InvoiceIn(BaseModel):
    flat_id: str
    amount: float
    description: str
    month: str  # e.g. "2026-02"
    due_date: str  # ISO date

class InvoicePay(BaseModel):
    method: Optional[str] = "manual"
    note: Optional[str] = None

class ExpenseIn(BaseModel):
    title: str
    amount: float
    category: str
    date: str  # ISO
    description: Optional[str] = None
    receipt_file_id: Optional[str] = None

class ComplaintIn(BaseModel):
    title: str
    description: str
    category: str = "general"  # plumbing, electrical, security, cleanliness, general

class ComplaintUpdate(BaseModel):
    status: Optional[str] = None  # open, in_progress, resolved
    resolution_note: Optional[str] = None
    assigned_to: Optional[str] = None  # staff id, or "" to unassign

class StaffIn(BaseModel):
    name: str = Field(min_length=1)
    role_label: str = Field(min_length=1)  # e.g. "Plumber", "Lift technician"
    category: str = "general"  # matches complaint categories: plumbing/electrical/security/cleanliness/parking/amenities/general/lift/other
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    vendor_org: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True

class StaffUpdate(BaseModel):
    name: Optional[str] = None
    role_label: Optional[str] = None
    category: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    vendor_org: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None

class AnnouncementIn(BaseModel):
    title: str
    content: str
    category: str = "general"  # notice, event, maintenance, general

class VisitorIn(BaseModel):
    name: str
    phone: Optional[str] = None
    purpose: str
    flat_id: str
    vehicle_no: Optional[str] = None

class SocietyIn(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    established_year: Optional[int] = None
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    logo_file_id: Optional[str] = None
    upi_id: Optional[str] = None
    upi_qr_file_id: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_number: Optional[str] = None
    bank_account_holder: Optional[str] = None
    bank_ifsc: Optional[str] = None

UTILITY_TYPES = ("electricity", "piped_gas", "water", "internet", "dth", "other")

class UtilityConnectionIn(BaseModel):
    utility_type: str
    provider_name: str = Field(min_length=1)
    customer_id: str = Field(min_length=1)
    meter_number: Optional[str] = None
    notes: Optional[str] = None

class UtilityBillIn(BaseModel):
    flat_id: Optional[str] = None
    utility_type: str
    connection_id: Optional[str] = None
    provider_name: Optional[str] = None
    customer_id: Optional[str] = None
    amount: float
    bill_period: str
    due_date: str
    notes: Optional[str] = None
    receipt_file_id: Optional[str] = None

class UtilityBillPay(BaseModel):
    method: Optional[str] = "manual"
    note: Optional[str] = None

class AmenityIn(BaseModel):
    name: str
    description: Optional[str] = None
    capacity: Optional[int] = None
    open_time: str = "06:00"   # HH:MM 24h
    close_time: str = "22:00"
    slot_duration_minutes: int = 60
    price_per_slot: float = 0
    is_active: bool = True
    image_url: Optional[str] = None

class BookingIn(BaseModel):
    amenity_id: str
    date: str          # YYYY-MM-DD
    start_time: str    # HH:MM
    end_time: str      # HH:MM
    notes: Optional[str] = None

# ---------- Helpers ----------
def now_iso():
    return datetime.now(timezone.utc).isoformat()

def clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    doc.pop("password_hash", None)
    return doc

def new_id():
    return str(uuid.uuid4())

async def enrich_user_flat(u: dict):
    if u.get("flat_id"):
        f = await db.flats.find_one({"id": u["flat_id"]}, {"_id": 0})
        u["flat"] = f
    return u

# ---------- Auth ----------
@api.post("/auth/register")
async def register(data: RegisterIn, response: Response):
    email = data.email.lower()
    # Look up in master user_index to see if email exists somewhere
    existing = await master_db.user_index.find_one({"email": email})
    if existing:
        raise HTTPException(400, "Email already registered")
    # Self-register goes into the DEFAULT society
    default_soc = await master_db.societies.find_one({"is_default": True})
    if not default_soc:
        raise HTTPException(500, "No default society configured")
    _current_db.set(_get_society_db(default_soc["id"]))
    user = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "phone": data.phone,
        "role": "resident",
        "flat_id": None,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    await master_db.user_index.insert_one({
        "email": email, "user_id": user["id"], "society_id": default_soc["id"], "kind": "society"
    })
    at = create_access_token(user["id"], email, "resident", "society", default_soc["id"])
    rt = create_refresh_token(user["id"])
    set_auth_cookies(response, at, rt)
    return {**clean(user), "society_id": default_soc["id"], "access_token": at}

@api.post("/auth/login")
async def login(data: LoginIn, response: Response):
    email = data.email.lower()
    # 1) Master user?
    mu = await master_db.master_users.find_one({"email": email, "is_active": True})
    if mu and verify_password(data.password, mu["password_hash"]):
        at = create_access_token(mu["id"], email, mu["role"], "master")
        rt = create_refresh_token(mu["id"])
        set_auth_cookies(response, at, rt)
        return {"id": mu["id"], "email": email, "name": mu["name"], "role": mu["role"], "kind": "master", "access_token": at}
    # 2) Society user via master user_index
    idx = await master_db.user_index.find_one({"email": email, "kind": "society"})
    if not idx:
        raise HTTPException(401, "Invalid email or password")
    soc = await master_db.societies.find_one({"id": idx["society_id"]})
    if not soc:
        raise HTTPException(401, "Invalid email or password")
    if soc.get("status") == "suspended":
        raise HTTPException(403, "This society is suspended. Contact support.")
    _current_db.set(_get_society_db(idx["society_id"]))
    user = await db.users.find_one({"id": idx["user_id"]})
    if not user or not verify_password(data.password, user["password_hash"]):
        raise HTTPException(401, "Invalid email or password")
    at = create_access_token(user["id"], email, user["role"], "society", idx["society_id"])
    rt = create_refresh_token(user["id"])
    set_auth_cookies(response, at, rt)
    return {**clean(user), "society_id": idx["society_id"], "society_name": soc["name"], "kind": "society", "access_token": at}

@api.post("/auth/logout")
async def logout(response: Response, _: dict = Depends(get_current_user)):
    clear_auth_cookies(response)
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return await enrich_user_flat(user)

# ---------- Society settings ----------
SOCIETY_ID = "singleton"

SOCIETY_DEFAULTS = {
    "name": None, "address": None, "city": None, "established_year": None,
    "contact_email": None, "contact_phone": None,
    "logo_file_id": None, "upi_id": None, "upi_qr_file_id": None,
    "bank_name": None, "bank_account_number": None, "bank_account_holder": None, "bank_ifsc": None,
    "is_setup": False,
}

async def _get_society():
    doc = await db.society.find_one({"id": SOCIETY_ID}, {"_id": 0})
    if not doc:
        doc = {
            "id": SOCIETY_ID,
            **SOCIETY_DEFAULTS,
            "name": APP_NAME.capitalize() + " Society",
            "created_at": now_iso(),
        }
        await db.society.insert_one(doc)
        doc.pop("_id", None)
        return doc
    for k, v in SOCIETY_DEFAULTS.items():
        doc.setdefault(k, v)
    return doc

@api.get("/society")
async def get_society(_: dict = Depends(get_current_user)):
    return await _get_society()

@api.patch("/society")
async def update_society(data: SocietyIn, _: dict = Depends(require_admin)):
    """Update society settings. Explicit empty strings clear a value; missing fields are untouched.
    Name cannot be blanked to empty once set."""
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload:
        if payload["name"] is None or str(payload["name"]).strip() == "":
            raise HTTPException(400, "Society name cannot be empty")
    upd = {}
    for k, v in payload.items():
        upd[k] = None if v == "" else v
    upd["is_setup"] = True
    upd["updated_at"] = now_iso()
    await db.society.update_one({"id": SOCIETY_ID}, {"$set": upd}, upsert=True)
    return await _get_society()

# ---------- Directory ----------
async def _flat_label_map(flat_ids: list) -> dict:
    """Batch fetch flats by id and return {flat_id: 'block-number'}."""
    ids = [fid for fid in flat_ids if fid]
    if not ids:
        return {}
    out = {}
    async for f in db.flats.find({"id": {"$in": list(set(ids))}}, {"_id": 0}):
        out[f["id"]] = f"{f['block']}-{f['number']}"
    return out

async def _flat_map(flat_ids: list) -> dict:
    """Batch fetch flats by id and return {flat_id: flat_doc}."""
    ids = [fid for fid in flat_ids if fid]
    if not ids:
        return {}
    out = {}
    async for f in db.flats.find({"id": {"$in": list(set(ids))}}, {"_id": 0}):
        out[f["id"]] = f
    return out

@api.get("/directory")
async def directory(_: dict = Depends(get_current_user)):
    """All residents can see everyone's name + role + flat (contact info visible to committee/admin only via /committee)."""
    docs = await db.users.find({}, {"password_hash": 0, "_id": 0}).to_list(2000)
    labels = await _flat_label_map([u.get("flat_id") for u in docs])
    out = []
    for u in docs:
        out.append({
            "id": u["id"],
            "name": u["name"],
            "role": u["role"],
            "flat_label": labels.get(u.get("flat_id")),
            "email": u["email"],
            "phone": u.get("phone"),
        })
    out.sort(key=lambda x: (x["role"] != "admin", x["role"] != "committee", x["name"].lower()))
    return out

@api.get("/committee")
async def committee(_: dict = Depends(get_current_user)):
    """Public-to-residents list of admin+committee members with contact info."""
    docs = await db.users.find({"role": {"$in": ["admin", "committee"]}}, {"password_hash": 0, "_id": 0}).to_list(200)
    labels = await _flat_label_map([u.get("flat_id") for u in docs])
    for u in docs:
        u["flat_label"] = labels.get(u.get("flat_id"))
    docs.sort(key=lambda u: (u["role"] != "admin", u["name"].lower()))
    return docs

# ---------- Password Reset ----------
class ForgotIn(BaseModel):
    email: EmailStr

class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=6)

@api.post("/auth/forgot-password")
async def forgot_password(data: ForgotIn, background: BackgroundTasks):
    email = data.email.lower()
    user = await db.users.find_one({"email": email})
    # Always return ok to avoid email enumeration
    if user:
        token = secrets.token_urlsafe(32)
        expires = datetime.now(timezone.utc) + timedelta(hours=1)
        await db.password_reset_tokens.insert_one({
            "token": token,
            "user_id": user["id"],
            "email": email,
            "expires_at": expires,
            "used": False,
            "created_at": now_iso(),
        })
        link = f"{FRONTEND_URL}/reset-password?token={token}"
        body = (f"<p>Hi {user['name']},</p>"
                f"<p>Someone (hopefully you) asked to reset your maintyn password. "
                f"Click the button below within the next hour to choose a new one. "
                f"If it wasn't you, you can safely ignore this email.</p>"
                f"<p style='font-size:12px;color:#576B61'>Or paste this link into your browser:<br>"
                f"<span style='word-break:break-all'>{link}</span></p>")
        html = _email_frame("Reset your password", body, link, "Reset password")
        background.add_task(send_email_raw, email, "Reset your maintyn password", html)
        logger.info(f"Password reset link for {email}: {link}")
    return {"ok": True}

@api.post("/auth/reset-password")
async def reset_password(data: ResetIn):
    rec = await db.password_reset_tokens.find_one({"token": data.token})
    if not rec or rec.get("used"):
        raise HTTPException(400, "Invalid or expired token")
    exp = rec["expires_at"]
    if isinstance(exp, str):
        exp = datetime.fromisoformat(exp)
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(400, "Token expired")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_password(data.password)}})
    await db.password_reset_tokens.update_one({"token": data.token}, {"$set": {"used": True}})
    return {"ok": True}


async def get_master_user(user: dict = Depends(get_current_user)) -> dict:
    if user.get("kind") != "master":
        raise HTTPException(403, "Master access required")
    return user

async def require_super_admin(user: dict = Depends(get_master_user)) -> dict:
    if user["role"] != "super_admin":
        raise HTTPException(403, "Super-admin only")
    return user

# ---------- Master console ----------
class SocietyCreateIn(BaseModel):
    name: str = Field(min_length=1)
    admin_name: str = Field(min_length=1)
    admin_email: EmailStr
    admin_password: str = Field(min_length=6)
    admin_phone: Optional[str] = None

class MasterUserIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)
    role: str = "support"  # super_admin | support

@api.get("/master/session")
async def master_session(user: dict = Depends(get_master_user)):
    return user

@api.get("/master/societies")
async def list_societies(_: dict = Depends(get_master_user)):
    docs = await master_db.societies.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    out = []
    for s in docs:
        sid = s["id"]
        sdb = _get_society_db(sid)
        residents = await sdb.users.count_documents({"role": "resident"})
        unpaid = await sdb.invoices.count_documents({"status": "unpaid"})
        flats = await sdb.flats.count_documents({})
        out.append({**s, "residents": residents, "unpaid_invoices": unpaid, "flats": flats})
    return out

@api.post("/master/societies")
async def create_society(data: SocietyCreateIn, current: dict = Depends(require_super_admin), background: BackgroundTasks = None):
    email = data.admin_email.lower()
    if await master_db.user_index.find_one({"email": email}):
        raise HTTPException(400, "Admin email already registered elsewhere")
    sid = new_id()
    soc = {
        "id": sid,
        "name": data.name,
        "db_name": _db_name_for_society(sid),
        "status": "active",
        "is_default": False,
        "first_admin_email": email,
        "first_admin_name": data.admin_name,
        "created_by": current["id"],
        "created_at": now_iso(),
    }
    await master_db.societies.insert_one(soc); soc.pop("_id", None)
    sdb = _get_society_db(sid)
    await sdb.users.create_index("id", unique=True)
    await sdb.users.create_index("email", unique=True)
    await sdb.flats.create_index("id", unique=True)
    await sdb.invoices.create_index("id", unique=True); await sdb.invoices.create_index("flat_id")
    await sdb.expenses.create_index("id", unique=True)
    await sdb.complaints.create_index("id", unique=True)
    await sdb.announcements.create_index("id", unique=True)
    await sdb.visitors.create_index("id", unique=True)
    await sdb.files.create_index("id", unique=True)
    await sdb.amenities.create_index("id", unique=True)
    await sdb.bookings.create_index("id", unique=True)
    await sdb.utility_connections.create_index("id", unique=True)
    await sdb.utility_bills.create_index("id", unique=True)
    await sdb.staff.create_index("id", unique=True)
    await sdb.staff.create_index("category")
    admin_user = {
        "id": new_id(), "email": email, "password_hash": hash_password(data.admin_password),
        "name": data.admin_name, "phone": data.admin_phone, "role": "admin",
        "flat_id": None, "created_at": now_iso(),
    }
    await sdb.users.insert_one(admin_user); admin_user.pop("_id", None); admin_user.pop("password_hash", None)
    await master_db.user_index.insert_one({"email": email, "user_id": admin_user["id"], "society_id": sid, "kind": "society"})
    # Welcome email
    body = (f"<p>Hi {data.admin_name},</p>"
            f"<p>Your society <b>{data.name}</b> has been set up on maintyn.</p>"
            f"<p>Sign in as admin using these credentials:</p>"
            f"<table cellpadding='6' style='border-collapse:collapse;font-size:14px;margin:12px 0'>"
            f"<tr><td style='color:#576B61'>Email</td><td><b>{email}</b></td></tr>"
            f"<tr><td style='color:#576B61'>Temporary password</td><td><code>{data.admin_password}</code></td></tr>"
            f"</table>"
            f"<p>After first sign-in, please reset your password via 'Forgot password?'.</p>")
    html = _email_frame(f"Welcome to {data.name} on maintyn", body, f"{FRONTEND_URL}/login", "Sign in")
    if background is not None:
        background.add_task(send_email_raw, email, f"Welcome to {data.name} on maintyn", html)
    return {**soc, "admin_user_id": admin_user["id"]}

@api.patch("/master/societies/{sid}/status")
async def toggle_society(sid: str, payload: dict, _: dict = Depends(require_super_admin)):
    status = payload.get("status")
    if status not in ("active", "suspended"):
        raise HTTPException(400, "status must be 'active' or 'suspended'")
    res = await master_db.societies.update_one({"id": sid}, {"$set": {"status": status, "updated_at": now_iso()}})
    if res.matched_count == 0:
        raise HTTPException(404, "Society not found")
    return await master_db.societies.find_one({"id": sid}, {"_id": 0})

@api.delete("/master/societies/{sid}")
async def delete_society(sid: str, _: dict = Depends(require_super_admin)):
    soc = await master_db.societies.find_one({"id": sid})
    if not soc:
        raise HTTPException(404, "Society not found")
    if soc.get("is_default"):
        raise HTTPException(400, "Cannot delete the Default society")
    await client.drop_database(_db_name_for_society(sid))
    await master_db.user_index.delete_many({"society_id": sid})
    await master_db.societies.delete_one({"id": sid})
    return {"ok": True}

@api.post("/master/societies/{sid}/impersonate")
async def impersonate(sid: str, response: Response, current: dict = Depends(get_master_user)):
    soc = await master_db.societies.find_one({"id": sid})
    if not soc:
        raise HTTPException(404, "Society not found")
    sdb = _get_society_db(sid)
    admin = await sdb.users.find_one({"role": "admin"}) or await sdb.users.find_one({})
    if not admin:
        raise HTTPException(400, "No users exist in that society yet")
    at = create_access_token(admin["id"], admin["email"], admin["role"], "society", sid)
    rt = create_refresh_token(admin["id"])
    set_auth_cookies(response, at, rt)
    return {"society_id": sid, "society_name": soc["name"], "user": {"id": admin["id"], "email": admin["email"], "name": admin["name"], "role": admin["role"]}, "access_token": at, "impersonated_by": current["email"]}

@api.get("/master/rollup")
async def rollup(_: dict = Depends(get_master_user)):
    societies = await master_db.societies.find({}, {"_id": 0}).to_list(1000)
    total_res = 0; total_flats = 0; total_unpaid = 0; total_open_complaints = 0; total_pending_amt = 0.0
    for s in societies:
        sdb = _get_society_db(s["id"])
        total_res += await sdb.users.count_documents({"role": "resident"})
        total_flats += await sdb.flats.count_documents({})
        total_unpaid += await sdb.invoices.count_documents({"status": "unpaid"})
        total_open_complaints += await sdb.complaints.count_documents({"status": {"$in": ["open", "in_progress"]}})
        agg = await sdb.invoices.aggregate([{"$match": {"status": "unpaid"}}, {"$group": {"_id": None, "t": {"$sum": "$amount"}}}]).to_list(1)
        if agg: total_pending_amt += float(agg[0]["t"])
    return {"societies": len(societies), "total_residents": total_res, "total_flats": total_flats,
            "total_unpaid_invoices": total_unpaid, "total_open_complaints": total_open_complaints,
            "total_pending_amount": total_pending_amt}

@api.get("/master/users")
async def list_master_users(_: dict = Depends(require_super_admin)):
    docs = await master_db.master_users.find({}, {"password_hash": 0, "_id": 0}).sort("created_at", -1).to_list(500)
    return docs

@api.post("/master/users")
async def create_master_user(data: MasterUserIn, _: dict = Depends(require_super_admin)):
    email = data.email.lower()
    if await master_db.master_users.find_one({"email": email}):
        raise HTTPException(400, "Email already exists")
    if data.role not in ("super_admin", "support"):
        raise HTTPException(400, "Invalid role")
    u = {"id": new_id(), "email": email, "name": data.name, "role": data.role,
         "password_hash": hash_password(data.password), "is_active": True, "created_at": now_iso()}
    await master_db.master_users.insert_one(u); u.pop("_id", None); u.pop("password_hash", None)
    return u

@api.patch("/master/users/{uid}")
async def update_master_user(uid: str, payload: dict, _: dict = Depends(require_super_admin)):
    upd = {}
    if "is_active" in payload: upd["is_active"] = bool(payload["is_active"])
    if "role" in payload and payload["role"] in ("super_admin", "support"): upd["role"] = payload["role"]
    if "password" in payload and payload["password"]:
        upd["password_hash"] = hash_password(payload["password"])
    if not upd:
        raise HTTPException(400, "No changes")
    res = await master_db.master_users.update_one({"id": uid}, {"$set": upd})
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    doc = await master_db.master_users.find_one({"id": uid}, {"password_hash": 0, "_id": 0})
    return doc

@api.delete("/master/users/{uid}")
async def delete_master_user(uid: str, current: dict = Depends(require_super_admin)):
    if uid == current["id"]:
        raise HTTPException(400, "Cannot delete yourself")
    res = await master_db.master_users.delete_one({"id": uid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}

# ---------- Users ----------
@api.get("/users")
async def list_users(user: dict = Depends(require_staff)):
    docs = await db.users.find({}, {"password_hash": 0, "_id": 0}).to_list(1000)
    flats = await _flat_map([d.get("flat_id") for d in docs])
    for d in docs:
        if d.get("flat_id"):
            d["flat"] = flats.get(d["flat_id"])
    return docs

@api.post("/users")
async def create_user(data: UserCreate, current: dict = Depends(require_admin)):
    email = data.email.lower()
    if await master_db.user_index.find_one({"email": email}):
        raise HTTPException(400, "Email already registered")
    if data.role not in ("admin", "committee", "resident"):
        raise HTTPException(400, "Invalid role")
    u = {
        "id": new_id(),
        "email": email,
        "password_hash": hash_password(data.password),
        "name": data.name,
        "phone": data.phone,
        "role": data.role,
        "flat_id": data.flat_id,
        "created_at": now_iso(),
    }
    await db.users.insert_one(u)
    await master_db.user_index.insert_one({
        "email": email, "user_id": u["id"], "society_id": current["society_id"], "kind": "society"
    })
    return clean(u)

@api.patch("/users/{uid}")
async def update_user(uid: str, data: UserUpdate, _: dict = Depends(require_admin)):
    upd = {k: v for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if "password" in upd:
        upd["password_hash"] = hash_password(upd.pop("password"))
    if "role" in upd and upd["role"] not in ("admin", "committee", "resident"):
        raise HTTPException(400, "Invalid role")
    await db.users.update_one({"id": uid}, {"$set": upd})
    doc = await db.users.find_one({"id": uid}, {"password_hash": 0, "_id": 0})
    if not doc:
        raise HTTPException(404, "User not found")
    return doc

@api.delete("/users/{uid}")
async def delete_user(uid: str, current: dict = Depends(require_admin)):
    if uid == current["id"]:
        raise HTTPException(400, "Cannot delete yourself")
    doc = await db.users.find_one({"id": uid})
    if not doc:
        raise HTTPException(404, "User not found")
    await db.users.delete_one({"id": uid})
    await master_db.user_index.delete_one({"email": doc["email"], "society_id": current["society_id"]})
    return {"ok": True}

@api.post("/users/import-csv")
async def import_users_csv(file: UploadFile = File(...), _: dict = Depends(require_admin)):
    """CSV columns: name, email, phone, role, password, block, flat_number"""
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        try:
            email = (row.get("email") or "").strip().lower()
            name = (row.get("name") or "").strip()
            if not email or not name:
                errors.append(f"Row {i}: missing name/email")
                continue
            if await db.users.find_one({"email": email}):
                skipped += 1
                continue
            role = (row.get("role") or "resident").strip().lower()
            if role not in ("admin", "committee", "resident"):
                role = "resident"
            password = (row.get("password") or "welcome123").strip()
            flat_id = None
            block = (row.get("block") or "").strip()
            fnum = (row.get("flat_number") or "").strip()
            if block and fnum:
                f = await db.flats.find_one({"block": block, "number": fnum})
                if f:
                    flat_id = f["id"]
            await db.users.insert_one({
                "id": new_id(),
                "email": email,
                "password_hash": hash_password(password),
                "name": name,
                "phone": (row.get("phone") or "").strip() or None,
                "role": role,
                "flat_id": flat_id,
                "created_at": now_iso(),
            })
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "skipped": skipped, "errors": errors}

# ---------- Flats ----------
@api.get("/flats")
async def list_flats(user: dict = Depends(get_current_user)):
    docs = await db.flats.find({}, {"_id": 0}).sort([("block", 1), ("number", 1)]).to_list(2000)
    flat_ids = [f["id"] for f in docs]
    # Batch fetch all residents in one query
    residents_by_flat = {}
    if flat_ids:
        async for r in db.users.find({"flat_id": {"$in": flat_ids}}, {"password_hash": 0, "_id": 0}):
            residents_by_flat.setdefault(r["flat_id"], []).append(r)
    for f in docs:
        f["residents"] = residents_by_flat.get(f["id"], [])
    return docs

@api.get("/flats/summary")
async def flats_summary(_: dict = Depends(get_current_user)):
    docs = await db.flats.find({}, {"_id": 0}).to_list(2000)
    total = len(docs)
    owners = sum(1 for f in docs if f.get("occupancy") == "owner")
    tenants = sum(1 for f in docs if f.get("occupancy") == "tenant")
    vacant = sum(1 for f in docs if f.get("occupancy") == "vacant")
    occupied = owners + tenants
    blocks = {}
    for f in docs:
        b = f.get("block", "—")
        blocks[b] = blocks.get(b, 0) + 1
    return {
        "total": total,
        "occupied": occupied,
        "vacant": vacant,
        "owners": owners,
        "tenants": tenants,
        "blocks": [{"block": k, "count": v} for k, v in sorted(blocks.items())],
    }

@api.post("/flats")
async def create_flat(data: FlatIn, _: dict = Depends(require_staff)):
    f = {"id": new_id(), **data.model_dump(), "created_at": now_iso()}
    await db.flats.insert_one(f)
    f.pop("_id", None)
    return f

@api.patch("/flats/{fid}")
async def update_flat(fid: str, data: FlatIn, _: dict = Depends(require_staff)):
    upd = data.model_dump()
    await db.flats.update_one({"id": fid}, {"$set": upd})
    doc = await db.flats.find_one({"id": fid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Flat not found")
    return doc

@api.delete("/flats/{fid}")
async def delete_flat(fid: str, _: dict = Depends(require_admin)):
    res = await db.flats.delete_one({"id": fid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Flat not found")
    # Unlink from users
    await db.users.update_many({"flat_id": fid}, {"$set": {"flat_id": None}})
    return {"ok": True}

@api.post("/flats/import-csv")
async def import_flats_csv(file: UploadFile = File(...), _: dict = Depends(require_staff)):
    """CSV columns: block, number, floor (optional), bhk (optional), occupancy (optional; owner/tenant/vacant)"""
    content = (await file.read()).decode("utf-8", errors="ignore")
    reader = csv.DictReader(io.StringIO(content))
    created, skipped, errors = 0, 0, []
    for i, row in enumerate(reader, start=2):
        try:
            block = (row.get("block") or "").strip()
            number = (row.get("number") or "").strip()
            if not block or not number:
                errors.append(f"Row {i}: missing block/number")
                continue
            if await db.flats.find_one({"block": block, "number": number}):
                skipped += 1
                continue
            occupancy = (row.get("occupancy") or "vacant").strip().lower()
            if occupancy not in ("owner", "tenant", "vacant"):
                occupancy = "vacant"
            await db.flats.insert_one({
                "id": new_id(),
                "block": block,
                "number": number,
                "floor": (row.get("floor") or "").strip() or None,
                "bhk": (row.get("bhk") or "").strip() or None,
                "owner_id": None,
                "tenant_id": None,
                "occupancy": occupancy,
                "created_at": now_iso(),
            })
            created += 1
        except Exception as e:
            errors.append(f"Row {i}: {e}")
    return {"created": created, "skipped": skipped, "errors": errors}

# ---------- Invoices ----------
# ---------- Utility Connections & Bills ----------
def _can_access_flat(user: dict, flat_id: str) -> bool:
    if user["role"] in ("admin", "committee"):
        return True
    return user.get("flat_id") == flat_id

async def _enrich_bill(b: dict):
    if b.get("flat_id"):
        f = await db.flats.find_one({"id": b["flat_id"]}, {"_id": 0})
        b["flat"] = f
    return b

@api.get("/my-flat")
async def my_flat(user: dict = Depends(get_current_user)):
    if not user.get("flat_id"):
        return {"flat": None, "residents": [], "connections": [], "recent_bills": []}
    flat = await db.flats.find_one({"id": user["flat_id"]}, {"_id": 0})
    residents = await db.users.find({"flat_id": user["flat_id"]}, {"password_hash": 0, "_id": 0}).to_list(50)
    connections = await db.utility_connections.find({"flat_id": user["flat_id"]}, {"_id": 0}).sort("utility_type", 1).to_list(50)
    bills = await db.utility_bills.find({"flat_id": user["flat_id"]}, {"_id": 0}).sort("created_at", -1).limit(20).to_list(20)
    return {"flat": flat, "residents": residents, "connections": connections, "recent_bills": bills}

@api.get("/flats/{fid}/utility-connections")
async def list_utility_connections(fid: str, user: dict = Depends(get_current_user)):
    if not _can_access_flat(user, fid):
        raise HTTPException(403, "Not your flat")
    docs = await db.utility_connections.find({"flat_id": fid}, {"_id": 0}).sort("utility_type", 1).to_list(50)
    return docs

@api.post("/flats/{fid}/utility-connections")
async def create_utility_connection(fid: str, data: UtilityConnectionIn, user: dict = Depends(get_current_user)):
    if not _can_access_flat(user, fid):
        raise HTTPException(403, "Not your flat")
    if data.utility_type not in UTILITY_TYPES:
        raise HTTPException(400, f"Invalid utility_type. Allowed: {', '.join(UTILITY_TYPES)}")
    if not await db.flats.find_one({"id": fid}):
        raise HTTPException(404, "Flat not found")
    doc = {
        "id": new_id(),
        "flat_id": fid,
        **data.model_dump(),
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.utility_connections.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.patch("/utility-connections/{cid}")
async def update_utility_connection(cid: str, data: UtilityConnectionIn, user: dict = Depends(get_current_user)):
    conn = await db.utility_connections.find_one({"id": cid})
    if not conn:
        raise HTTPException(404, "Connection not found")
    if not _can_access_flat(user, conn["flat_id"]):
        raise HTTPException(403, "Not your flat")
    if data.utility_type not in UTILITY_TYPES:
        raise HTTPException(400, f"Invalid utility_type")
    await db.utility_connections.update_one({"id": cid}, {"$set": data.model_dump()})
    return await db.utility_connections.find_one({"id": cid}, {"_id": 0})

@api.delete("/utility-connections/{cid}")
async def delete_utility_connection(cid: str, user: dict = Depends(get_current_user)):
    conn = await db.utility_connections.find_one({"id": cid})
    if not conn:
        raise HTTPException(404, "Connection not found")
    if not _can_access_flat(user, conn["flat_id"]):
        raise HTTPException(403, "Not your flat")
    await db.utility_connections.delete_one({"id": cid})
    return {"ok": True}

@api.get("/utility-bills")
async def list_utility_bills(user: dict = Depends(get_current_user), flat_id: Optional[str] = None, status: Optional[str] = None):
    q = {}
    if user["role"] == "resident":
        if not user.get("flat_id"):
            return []
        q["flat_id"] = user["flat_id"]
    elif flat_id:
        q["flat_id"] = flat_id
    if status in ("paid", "unpaid"):
        q["status"] = status
    docs = await db.utility_bills.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    flats = await _flat_map([d.get("flat_id") for d in docs])
    for d in docs:
        d["flat"] = flats.get(d.get("flat_id"))
    return docs

@api.post("/utility-bills")
async def create_utility_bill(data: UtilityBillIn, user: dict = Depends(get_current_user)):
    flat_id = data.flat_id or user.get("flat_id")
    if not flat_id:
        raise HTTPException(400, "flat_id is required")
    if not _can_access_flat(user, flat_id):
        raise HTTPException(403, "Not your flat")
    if data.utility_type not in UTILITY_TYPES:
        raise HTTPException(400, "Invalid utility_type")
    provider_name = data.provider_name
    customer_id = data.customer_id
    if data.connection_id:
        conn = await db.utility_connections.find_one({"id": data.connection_id})
        if conn:
            provider_name = provider_name or conn["provider_name"]
            customer_id = customer_id or conn["customer_id"]
    bill = {
        "id": new_id(),
        "flat_id": flat_id,
        "utility_type": data.utility_type,
        "connection_id": data.connection_id,
        "provider_name": provider_name or "",
        "customer_id": customer_id or "",
        "amount": float(data.amount),
        "bill_period": data.bill_period,
        "due_date": data.due_date,
        "notes": data.notes,
        "receipt_file_id": data.receipt_file_id,
        "status": "unpaid",
        "paid_at": None,
        "payment_method": None,
        "payment_note": None,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.utility_bills.insert_one(bill)
    bill.pop("_id", None)
    return bill

@api.post("/utility-bills/{bid}/pay")
async def pay_utility_bill(bid: str, data: UtilityBillPay, user: dict = Depends(get_current_user)):
    bill = await db.utility_bills.find_one({"id": bid})
    if not bill:
        raise HTTPException(404, "Bill not found")
    if not _can_access_flat(user, bill["flat_id"]):
        raise HTTPException(403, "Not your flat")
    await db.utility_bills.update_one({"id": bid}, {"$set": {
        "status": "paid",
        "paid_at": now_iso(),
        "payment_method": data.method,
        "payment_note": data.note,
    }})
    return await db.utility_bills.find_one({"id": bid}, {"_id": 0})

@api.delete("/utility-bills/{bid}")
async def delete_utility_bill(bid: str, user: dict = Depends(get_current_user)):
    bill = await db.utility_bills.find_one({"id": bid})
    if not bill:
        raise HTTPException(404, "Bill not found")
    if not _can_access_flat(user, bill["flat_id"]):
        raise HTTPException(403, "Not your flat")
    await db.utility_bills.delete_one({"id": bid})
    return {"ok": True}


async def _notify_invoice_created(flat_id: str, amount: float, description: str, month: str, due_date: str):
    residents = await db.users.find({"flat_id": flat_id}, {"password_hash": 0}).to_list(50)
    if not residents:
        return
    flat = await db.flats.find_one({"id": flat_id})
    flat_label = f"{flat['block']}-{flat['number']}" if flat else "your flat"
    subject = f"New invoice: {description}"
    for r in residents:
        body = (f"<p>Hi {r['name']},</p>"
                f"<p>A new maintenance invoice has been raised for <b>{flat_label}</b>.</p>"
                f"<table cellpadding='6' style='border-collapse:collapse;font-size:14px;margin:12px 0'>"
                f"<tr><td style='color:#576B61'>Description</td><td><b>{description}</b></td></tr>"
                f"<tr><td style='color:#576B61'>Amount</td><td><b>₹{amount:,.0f}</b></td></tr>"
                f"<tr><td style='color:#576B61'>Month</td><td>{month}</td></tr>"
                f"<tr><td style='color:#576B61'>Due date</td><td>{due_date}</td></tr>"
                f"</table>"
                f"<p>Sign in to mark this invoice as paid once you've settled it.</p>")
        html = _email_frame("New invoice raised", body, f"{FRONTEND_URL}/app/invoices", "View invoices")
        await send_email_raw(r["email"], subject, html)

async def _notify_invoice_paid(invoice_id: str):
    """Send payment receipt email to residents of the flat when an invoice is marked paid."""
    inv = await db.invoices.find_one({"id": invoice_id})
    if not inv:
        return
    residents = await db.users.find({"flat_id": inv["flat_id"]}, {"password_hash": 0}).to_list(50)
    if not residents:
        return
    flat = await db.flats.find_one({"id": inv["flat_id"]})
    flat_label = f"{flat['block']}-{flat['number']}" if flat else "your flat"
    society_doc = await db.society.find_one({"id": SOCIETY_ID}) or {}
    society_name = society_doc.get("name") or "Society"
    paid_when = inv.get("paid_at", now_iso())
    try:
        paid_date_str = datetime.fromisoformat(paid_when.replace("Z", "+00:00")).strftime("%d %b %Y")
    except Exception:
        paid_date_str = paid_when[:10]
    receipt_no = f"RCPT-{invoice_id[:8].upper()}"
    subject = f"Payment receipt · {inv.get('description', 'Invoice')}"
    for r in residents:
        body = (
            f"<p>Hi {r['name']},</p>"
            f"<p>We've recorded your payment for <b>{flat_label}</b>. Thank you!</p>"
            f"<table cellpadding='6' style='border-collapse:collapse;font-size:14px;margin:12px 0;width:100%'>"
            f"<tr><td style='color:#576B61'>Receipt number</td><td><b>{receipt_no}</b></td></tr>"
            f"<tr><td style='color:#576B61'>Description</td><td><b>{inv.get('description','')}</b></td></tr>"
            f"<tr><td style='color:#576B61'>Amount paid</td><td><b>₹{float(inv.get('amount',0)):,.0f}</b></td></tr>"
            f"<tr><td style='color:#576B61'>Month</td><td>{inv.get('month','')}</td></tr>"
            f"<tr><td style='color:#576B61'>Payment method</td><td>{(inv.get('payment_method') or 'manual').replace('_',' ').title()}</td></tr>"
            f"<tr><td style='color:#576B61'>Paid on</td><td>{paid_date_str}</td></tr>"
            f"<tr><td style='color:#576B61'>Society</td><td>{society_name}</td></tr>"
            f"</table>"
            f"<p style='color:#576B61;font-size:12px'>Keep this email as your receipt. If anything looks wrong, reply to your society admin.</p>"
        )
        html = _email_frame("Payment received — receipt inside", body, f"{FRONTEND_URL}/app/invoices/{invoice_id}", "View invoice")
        await send_email_raw(r["email"], subject, html)

async def _notify_complaint_status(complaint: dict, new_status: str):
    if not complaint.get("created_by"):
        return
    user = await db.users.find_one({"id": complaint["created_by"]})
    if not user:
        return
    label = new_status.replace("_", " ").title()
    body = (f"<p>Hi {user['name']},</p>"
            f"<p>Your complaint <b>“{complaint['title']}”</b> is now <b>{label}</b>.</p>")
    html = _email_frame(f"Complaint {label}", body, f"{FRONTEND_URL}/app/complaints", "View complaint")
    await send_email_raw(user["email"], f"Complaint update: {complaint['title']}", html)

@api.get("/invoices")
async def list_invoices(user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] == "resident":
        # only invoices for their flat
        if not user.get("flat_id"):
            return []
        query["flat_id"] = user["flat_id"]
    docs = await db.invoices.find(query, {"_id": 0}).sort("created_at", -1).to_list(2000)
    flats = await _flat_map([d.get("flat_id") for d in docs])
    for d in docs:
        d["flat"] = flats.get(d.get("flat_id"))
    return docs

@api.post("/invoices")
async def create_invoice(data: InvoiceIn, background: BackgroundTasks, user: dict = Depends(require_staff)):
    flat = await db.flats.find_one({"id": data.flat_id})
    if not flat:
        raise HTTPException(404, "Flat not found")
    inv = {
        "id": new_id(),
        **data.model_dump(),
        "status": "unpaid",
        "paid_at": None,
        "payment_method": None,
        "created_by": user["id"],
        "created_at": now_iso(),
    }
    await db.invoices.insert_one(inv)
    inv.pop("_id", None)
    background.add_task(_notify_invoice_created, data.flat_id, data.amount, data.description, data.month, data.due_date)
    return inv

@api.post("/invoices/bulk")
async def bulk_create_invoices(payload: dict, background: BackgroundTasks, user: dict = Depends(require_staff)):
    """Create invoices for all flats. payload: {amount, description, month, due_date}"""
    amount = payload["amount"]
    description = payload["description"]
    month = payload["month"]
    due_date = payload["due_date"]
    flats = await db.flats.find({}).to_list(2000)
    created = []
    for f in flats:
        inv = {
            "id": new_id(),
            "flat_id": f["id"],
            "amount": amount,
            "description": description,
            "month": month,
            "due_date": due_date,
            "status": "unpaid",
            "paid_at": None,
            "payment_method": None,
            "created_by": user["id"],
            "created_at": now_iso(),
        }
        await db.invoices.insert_one(inv)
        inv.pop("_id", None)
        created.append(inv)
        background.add_task(_notify_invoice_created, f["id"], amount, description, month, due_date)
    return {"count": len(created)}

@api.post("/invoices/{iid}/pay")
async def mark_paid(iid: str, data: InvoicePay, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    inv = await db.invoices.find_one({"id": iid})
    if not inv:
        raise HTTPException(404, "Invoice not found")
    if user["role"] == "resident" and inv["flat_id"] != user.get("flat_id"):
        raise HTTPException(403, "Not your invoice")
    was_unpaid = inv.get("status") != "paid"
    await db.invoices.update_one({"id": iid}, {"$set": {
        "status": "paid",
        "paid_at": now_iso(),
        "payment_method": data.method,
        "payment_note": data.note,
    }})
    doc = await db.invoices.find_one({"id": iid}, {"_id": 0})
    if was_unpaid:
        background.add_task(_notify_invoice_paid, iid)
    return doc

@api.delete("/invoices/{iid}")
async def delete_invoice(iid: str, _: dict = Depends(require_staff)):
    res = await db.invoices.delete_one({"id": iid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Invoice not found")
    return {"ok": True}

# ---------- Files ----------
@api.post("/files/upload")
async def upload_file(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    fid = new_id()
    path = f"{APP_NAME}/uploads/{user['id']}/{fid}.{ext}"
    data = await file.read()
    result = put_object(path, data, file.content_type or "application/octet-stream")
    rec = {
        "id": fid,
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": file.content_type or "application/octet-stream",
        "size": result.get("size", len(data)),
        "uploaded_by": user["id"],
        "is_deleted": False,
        "created_at": now_iso(),
    }
    await db.files.insert_one(rec)
    rec.pop("_id", None)
    return rec

@api.get("/files/{fid}/download")
async def download_file(fid: str, request: Request, auth: Optional[str] = Query(None)):
    # Auth: cookie or bearer or ?auth=token
    token = request.cookies.get("access_token")
    if not token:
        ah = request.headers.get("Authorization", "")
        if ah.startswith("Bearer "):
            token = ah[7:]
    if not token and auth:
        token = auth
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception:
        raise HTTPException(401, "Invalid token")
    rec = await db.files.find_one({"id": fid, "is_deleted": False})
    if not rec:
        raise HTTPException(404, "File not found")
    data, ct = get_object(rec["storage_path"])
    return FastAPIResponse(content=data, media_type=rec.get("content_type", ct))

# ---------- Expenses ----------
@api.get("/expenses")
async def list_expenses(user: dict = Depends(get_current_user)):
    docs = await db.expenses.find({}, {"_id": 0}).sort("date", -1).to_list(2000)
    return docs

@api.post("/expenses")
async def create_expense(data: ExpenseIn, user: dict = Depends(require_staff)):
    exp = {
        "id": new_id(),
        **data.model_dump(),
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_iso(),
    }
    await db.expenses.insert_one(exp)
    exp.pop("_id", None)
    return exp

@api.delete("/expenses/{eid}")
async def delete_expense(eid: str, _: dict = Depends(require_staff)):
    res = await db.expenses.delete_one({"id": eid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Expense not found")
    return {"ok": True}

# ---------- Complaints ----------
@api.get("/announcements")
async def list_announcements(_: dict = Depends(get_current_user)):
    docs = await db.announcements.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return docs

@api.post("/announcements")
async def create_announcement(data: AnnouncementIn, user: dict = Depends(require_staff)):
    a = {
        "id": new_id(),
        **data.model_dump(),
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_iso(),
    }
    await db.announcements.insert_one(a)
    a.pop("_id", None)
    return a

@api.delete("/announcements/{aid}")
async def delete_announcement(aid: str, _: dict = Depends(require_staff)):
    res = await db.announcements.delete_one({"id": aid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Announcement not found")
    return {"ok": True}

# ---------- Visitors ----------
@api.get("/visitors")
async def list_visitors(user: dict = Depends(get_current_user)):
    query = {}
    if user["role"] == "resident":
        if not user.get("flat_id"):
            return []
        query["flat_id"] = user["flat_id"]
    docs = await db.visitors.find(query, {"_id": 0}).sort("check_in", -1).to_list(2000)
    flats = await _flat_map([d.get("flat_id") for d in docs])
    for d in docs:
        d["flat"] = flats.get(d.get("flat_id"))
    return docs

@api.post("/visitors")
async def create_visitor(data: VisitorIn, user: dict = Depends(get_current_user)):
    v = {
        "id": new_id(),
        **data.model_dump(),
        "check_in": now_iso(),
        "check_out": None,
        "logged_by": user["id"],
    }
    await db.visitors.insert_one(v)
    v.pop("_id", None)
    return v

@api.post("/visitors/{vid}/checkout")
async def checkout_visitor(vid: str, _: dict = Depends(get_current_user)):
    await db.visitors.update_one({"id": vid}, {"$set": {"check_out": now_iso()}})
    doc = await db.visitors.find_one({"id": vid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Visitor not found")
    return doc

# ---------- Amenities & Bookings ----------
def _parse_hm(hm: str) -> int:
    """Return minutes since 00:00 for HH:MM"""
    h, m = hm.split(":")
    return int(h) * 60 + int(m)

async def _has_conflict(amenity_id: str, date: str, start_m: int, end_m: int, exclude_id: Optional[str] = None) -> bool:
    q = {"amenity_id": amenity_id, "date": date, "status": {"$ne": "cancelled"}}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    async for b in db.bookings.find(q):
        b_start = _parse_hm(b["start_time"])
        b_end = _parse_hm(b["end_time"])
        # overlap if start < b_end AND end > b_start
        if start_m < b_end and end_m > b_start:
            return True
    return False

@api.get("/amenities")
async def list_amenities(user: dict = Depends(get_current_user)):
    q = {} if user["role"] in ("admin", "committee") else {"is_active": True}
    docs = await db.amenities.find(q, {"_id": 0}).sort("name", 1).to_list(200)
    return docs

@api.post("/amenities")
async def create_amenity(data: AmenityIn, _: dict = Depends(require_staff)):
    a = {"id": new_id(), **data.model_dump(), "created_at": now_iso()}
    await db.amenities.insert_one(a)
    a.pop("_id", None)
    return a

@api.patch("/amenities/{aid}")
async def update_amenity(aid: str, data: AmenityIn, _: dict = Depends(require_staff)):
    await db.amenities.update_one({"id": aid}, {"$set": data.model_dump()})
    doc = await db.amenities.find_one({"id": aid}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Amenity not found")
    return doc

@api.delete("/amenities/{aid}")
async def delete_amenity(aid: str, _: dict = Depends(require_admin)):
    res = await db.amenities.delete_one({"id": aid})
    if res.deleted_count == 0:
        raise HTTPException(404, "Amenity not found")
    # cancel future bookings for this amenity
    today = datetime.now(timezone.utc).date().isoformat()
    await db.bookings.update_many(
        {"amenity_id": aid, "date": {"$gte": today}, "status": {"$ne": "cancelled"}},
        {"$set": {"status": "cancelled", "cancelled_at": now_iso(), "cancel_reason": "Amenity removed"}}
    )
    return {"ok": True}

@api.get("/amenities/{aid}/slots")
async def amenity_slots(aid: str, date: str, _: dict = Depends(get_current_user)):
    """Return time slots for a given date with availability status."""
    amenity = await db.amenities.find_one({"id": aid})
    if not amenity:
        raise HTTPException(404, "Amenity not found")
    open_m = _parse_hm(amenity["open_time"])
    close_m = _parse_hm(amenity["close_time"])
    dur = int(amenity.get("slot_duration_minutes", 60))
    # Load existing bookings for that day
    existing = await db.bookings.find(
        {"amenity_id": aid, "date": date, "status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).to_list(500)
    booked_ranges = [(_parse_hm(b["start_time"]), _parse_hm(b["end_time"]), b) for b in existing]

    slots = []
    cur = open_m
    while cur + dur <= close_m:
        s, e = cur, cur + dur
        booking = None
        for bs, be, b in booked_ranges:
            if s < be and e > bs:
                booking = {"id": b["id"], "user_name": b.get("user_name"), "flat_label": b.get("flat_label")}
                break
        slots.append({
            "start_time": f"{s // 60:02d}:{s % 60:02d}",
            "end_time":   f"{e // 60:02d}:{e % 60:02d}",
            "booked": booking is not None,
            "booking": booking,
        })
        cur += dur
    amenity.pop("_id", None)
    return {"amenity": amenity, "date": date, "slots": slots}

@api.get("/bookings")
async def list_bookings(user: dict = Depends(get_current_user), scope: str = Query("all")):
    q = {}
    if user["role"] == "resident":
        q["user_id"] = user["id"]
    if scope == "upcoming":
        q["date"] = {"$gte": datetime.now(timezone.utc).date().isoformat()}
        q["status"] = {"$ne": "cancelled"}
    docs = await db.bookings.find(q, {"_id": 0}).sort([("date", -1), ("start_time", -1)]).to_list(500)
    for d in docs:
        a = await db.amenities.find_one({"id": d["amenity_id"]}, {"_id": 0})
        d["amenity"] = a
    return docs

@api.post("/bookings")
async def create_booking(data: BookingIn, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    amenity = await db.amenities.find_one({"id": data.amenity_id})
    if not amenity or not amenity.get("is_active", True):
        raise HTTPException(404, "Amenity not available")
    try:
        s = _parse_hm(data.start_time)
        e = _parse_hm(data.end_time)
    except Exception:
        raise HTTPException(400, "Invalid time format (HH:MM)")
    if e <= s:
        raise HTTPException(400, "End time must be after start time")
    open_m = _parse_hm(amenity["open_time"])
    close_m = _parse_hm(amenity["close_time"])
    if s < open_m or e > close_m:
        raise HTTPException(400, f"Slot outside amenity hours ({amenity['open_time']} – {amenity['close_time']})")
    # No past-date bookings
    today = datetime.now(timezone.utc).date().isoformat()
    if data.date < today:
        raise HTTPException(400, "Cannot book in the past")
    if await _has_conflict(data.amenity_id, data.date, s, e):
        raise HTTPException(409, "That slot is already booked")

    flat = None
    if user.get("flat_id"):
        flat = await db.flats.find_one({"id": user["flat_id"]}, {"_id": 0})
    flat_label = f"{flat['block']}-{flat['number']}" if flat else None

    b = {
        "id": new_id(),
        "amenity_id": data.amenity_id,
        "amenity_name": amenity["name"],
        "user_id": user["id"],
        "user_name": user["name"],
        "user_email": user["email"],
        "flat_id": user.get("flat_id"),
        "flat_label": flat_label,
        "date": data.date,
        "start_time": data.start_time,
        "end_time": data.end_time,
        "notes": data.notes,
        "status": "confirmed",
        "price": float(amenity.get("price_per_slot") or 0),
        "created_at": now_iso(),
        "cancelled_at": None,
        "cancel_reason": None,
    }
    await db.bookings.insert_one(b)
    b.pop("_id", None)

    # Email confirmation to booking user
    body = (
        f"<p>Hi {user['name']},</p>"
        f"<p>Your booking is <b>confirmed</b>.</p>"
        f"<table cellpadding='6' style='border-collapse:collapse;font-size:14px;margin:12px 0'>"
        f"<tr><td style='color:#576B61'>Amenity</td><td><b>{amenity['name']}</b></td></tr>"
        f"<tr><td style='color:#576B61'>Date</td><td>{data.date}</td></tr>"
        f"<tr><td style='color:#576B61'>Time</td><td>{data.start_time} – {data.end_time}</td></tr>"
        + (f"<tr><td style='color:#576B61'>Price</td><td>₹{b['price']:,.0f}</td></tr>" if b["price"] > 0 else "")
        + f"</table><p>See you there!</p>"
    )
    html = _email_frame("Booking confirmed", body, f"{FRONTEND_URL}/app/amenities", "View bookings")
    background.add_task(send_email_raw, user["email"], f"Booking confirmed: {amenity['name']}", html)
    return b

@api.post("/bookings/{bid}/cancel")
async def cancel_booking(bid: str, background: BackgroundTasks, user: dict = Depends(get_current_user)):
    b = await db.bookings.find_one({"id": bid})
    if not b:
        raise HTTPException(404, "Booking not found")
    if user["role"] == "resident" and b["user_id"] != user["id"]:
        raise HTTPException(403, "Not your booking")
    if b["status"] == "cancelled":
        return {**{k: v for k, v in b.items() if k != "_id"}}
    await db.bookings.update_one({"id": bid}, {"$set": {
        "status": "cancelled",
        "cancelled_at": now_iso(),
        "cancelled_by": user["id"],
    }})
    doc = await db.bookings.find_one({"id": bid}, {"_id": 0})
    body = (f"<p>Hi {b['user_name']},</p>"
            f"<p>Your booking for <b>{b.get('amenity_name')}</b> on <b>{b['date']}</b> "
            f"at {b['start_time']} – {b['end_time']} has been cancelled.</p>")
    html = _email_frame("Booking cancelled", body, f"{FRONTEND_URL}/app/amenities", "View bookings")
    background.add_task(send_email_raw, b["user_email"], f"Booking cancelled: {b.get('amenity_name')}", html)
    return doc

# ---------- Dashboard stats ----------
# ---------- Monthly Digest ----------
MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
               "July", "August", "September", "October", "November", "December"]

def _month_range(anchor: _date):
    """Given any date in the target month, return (start_iso, end_iso, next_start_iso)."""
    start = anchor.replace(day=1)
    if start.month == 12:
        next_start = start.replace(year=start.year + 1, month=1)
    else:
        next_start = start.replace(month=start.month + 1)
    return start.isoformat(), (next_start - timedelta(days=1)).isoformat(), next_start.isoformat()

async def _compute_digest_payload(target_month_anchor: _date) -> dict:
    """Build the shared numbers for a given month (uses month of target_month_anchor)."""
    start_iso, end_iso, next_start_iso = _month_range(target_month_anchor)
    label = f"{MONTH_NAMES[target_month_anchor.month - 1]} {target_month_anchor.year}"

    # Invoices with created_at within month (aggregate for counts + sums)
    inv_agg = await db.invoices.aggregate([
        {"$match": {"created_at": {"$gte": start_iso, "$lt": next_start_iso}}},
        {"$group": {"_id": "$status", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}
    ]).to_list(10)
    inv_paid_count = 0
    inv_unpaid_count = 0
    collected = 0.0
    pending = 0.0
    for g in inv_agg:
        if g["_id"] == "paid":
            inv_paid_count = int(g["count"])
            collected = float(g["total"])
        else:
            inv_unpaid_count += int(g["count"])
            pending += float(g["total"])
    total_invoices = inv_paid_count + inv_unpaid_count
    collection_pct = int(round((inv_paid_count / total_invoices) * 100)) if total_invoices else 0

    # Complaints resolved this month
    resolved_count = await db.complaints.count_documents(
        {"status": "resolved", "resolved_at": {"$gte": start_iso, "$lt": next_start_iso}}
    )
    open_now = await db.complaints.count_documents({"status": {"$in": ["open", "in_progress"]}})

    # Expenses in month (aggregate)
    exp_agg = await db.expenses.aggregate([
        {"$match": {"date": {"$gte": start_iso, "$lt": next_start_iso}}},
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    expenses_total = float(exp_agg[0]["total"]) if exp_agg else 0.0

    # Upcoming bookings (from tomorrow, next 30 days)
    today_iso = _date.today().isoformat()
    horizon = (_date.today() + timedelta(days=30)).isoformat()
    upcoming = await db.bookings.find(
        {"date": {"$gte": today_iso, "$lte": horizon}, "status": {"$ne": "cancelled"}},
        {"_id": 0}
    ).sort([("date", 1), ("start_time", 1)]).limit(5).to_list(5)

    # Notices posted in month
    notices = await db.announcements.find(
        {"created_at": {"$gte": start_iso, "$lt": next_start_iso}},
        {"_id": 0}
    ).sort("created_at", -1).limit(5).to_list(5)

    return {
        "label": label,
        "month_start": start_iso,
        "month_end": end_iso,
        "collection_pct": collection_pct,
        "invoices_paid": inv_paid_count,
        "invoices_unpaid": inv_unpaid_count,
        "total_invoices": total_invoices,
        "collected": collected,
        "pending": pending,
        "expenses_total": expenses_total,
        "resolved_complaints": resolved_count,
        "open_complaints": open_now,
        "upcoming_bookings": upcoming,
        "notices": notices,
    }

def _digest_html(user: dict, p: dict) -> str:
    inr = lambda n: f"₹{n:,.0f}"
    first_name = (user.get("name") or "Resident").split()[0]
    bar = f"""
      <div style="background:#F6F4F1;border-radius:999px;height:10px;overflow:hidden;margin:8px 0 4px">
        <div style="background:#C85A3C;height:10px;width:{p['collection_pct']}%"></div>
      </div>
      <p style="font-size:12px;color:#576B61;margin:0">{p['invoices_paid']} of {p['total_invoices']} invoices paid</p>
    """
    upcoming_html = ""
    if p["upcoming_bookings"]:
        rows = "".join(
            f"<tr><td style='padding:6px 0;border-bottom:1px solid #E2DFD8'>"
            f"<b>{b.get('amenity_name','—')}</b><br>"
            f"<span style='color:#576B61;font-size:12px'>{b['date']} · {b['start_time']}–{b['end_time']} · {b.get('user_name','')}</span>"
            f"</td></tr>"
            for b in p["upcoming_bookings"]
        )
        upcoming_html = f"<h3 style='margin:24px 0 8px;font-size:16px'>Coming up</h3><table width='100%' cellpadding='0' cellspacing='0'>{rows}</table>"
    notices_html = ""
    if p["notices"]:
        items = "".join(
            f"<li style='margin:6px 0'><b>{n['title']}</b> "
            f"<span style='color:#576B61;font-size:12px'>· {n.get('category','general')}</span></li>"
            for n in p["notices"]
        )
        notices_html = f"<h3 style='margin:24px 0 8px;font-size:16px'>Notices this month</h3><ul style='padding-left:18px;margin:0'>{items}</ul>"

    personal = ""
    if user.get("role") == "resident" and user.get("flat_id"):
        personal = f"<p style='margin:12px 0;color:#1B3127'>Hi {first_name}, here's a snapshot of your community this month.</p>"
    else:
        personal = f"<p style='margin:12px 0;color:#1B3127'>Hi {first_name}, here's how the community did this month.</p>"

    body = f"""
      {personal}
      <h3 style="margin:24px 0 8px;font-size:16px">Where we stand</h3>
      <p style="margin:0"><b style="font-size:22px">{p['collection_pct']}%</b> collection · <b>{inr(p['collected'])}</b> collected</p>
      {bar}
      <p style="font-size:13px;color:#576B61;margin-top:6px">
        {inr(p['pending'])} pending · {inr(p['expenses_total'])} spent
      </p>

      <h3 style="margin:24px 0 8px;font-size:16px">You resolved {p['resolved_complaints']} complaint{'s' if p['resolved_complaints']!=1 else ''}</h3>
      <p style="margin:0;color:#576B61;font-size:14px">{p['open_complaints']} still open — sign in to help.</p>

      {upcoming_html}
      {notices_html}
    """
    return _email_frame(f"{p['label']} digest", body, f"{FRONTEND_URL}/app", "Open dashboard")

async def send_monthly_digest(target_month_anchor: Optional[_date] = None, dry_run: bool = False) -> dict:
    """Compute digest for the previous month and email every user.
    If target_month_anchor is None, uses last month.
    """
    if target_month_anchor is None:
        first_of_this_month = _date.today().replace(day=1)
        target_month_anchor = first_of_this_month - timedelta(days=1)  # any date in previous month

    payload = await _compute_digest_payload(target_month_anchor)
    month_key = payload["month_start"][:7]  # YYYY-MM

    # Idempotency check
    existing = await db.digest_runs.find_one({"month": month_key})
    if existing and not dry_run:
        logger.info(f"Digest for {month_key} already sent on {existing.get('sent_at')} to {existing.get('sent_count')} users")
        return {"skipped": True, "month": month_key, **payload}

    users = await db.users.find({}, {"password_hash": 0}).to_list(5000)
    sent = 0
    if not dry_run:
        for u in users:
            html = _digest_html(u, payload)
            try:
                await send_email_raw(u["email"], f"maintyn · {payload['label']} digest", html)
                sent += 1
            except Exception as e:
                logger.error(f"digest send failed for {u.get('email')}: {e}")
        await db.digest_runs.insert_one({
            "month": month_key,
            "label": payload["label"],
            "sent_at": now_iso(),
            "sent_count": sent,
            "total_users": len(users),
        })
    return {"skipped": False, "sent_count": sent, "total_users": len(users), "month": month_key, **payload}

# APScheduler runs on 1st of every month at 09:00 UTC
scheduler = AsyncIOScheduler(timezone="UTC")

async def _scheduled_digest():
    try:
        result = await send_monthly_digest()
        logger.info(f"Scheduled digest: {result.get('sent_count', 0)}/{result.get('total_users', 0)} sent for {result.get('month')}")
    except Exception as e:
        logger.exception(f"Scheduled digest failed: {e}")

@api.post("/admin/digest/preview")
async def digest_preview(_: dict = Depends(require_admin)):
    """Preview last month's digest payload without sending."""
    result = await send_monthly_digest(dry_run=True)
    return result

@api.post("/admin/digest/send")
async def digest_send_now(_: dict = Depends(require_admin)):
    """Send last month's digest immediately. Idempotent per YYYY-MM."""
    result = await send_monthly_digest(dry_run=False)
    return result

@api.get("/admin/digest/runs")
async def digest_runs(_: dict = Depends(require_admin)):
    docs = await db.digest_runs.find({}, {"_id": 0}).sort("sent_at", -1).to_list(50)
    return docs

@api.get("/stats")
async def stats(user: dict = Depends(get_current_user)):
    total_flats = await db.flats.count_documents({})
    total_users = await db.users.count_documents({})
    total_residents = await db.users.count_documents({"role": "resident"})
    unpaid = await db.invoices.count_documents({"status": "unpaid"})
    paid = await db.invoices.count_documents({"status": "paid"})
    open_complaints = await db.complaints.count_documents({"status": "open"})
    inprogress_complaints = await db.complaints.count_documents({"status": "in_progress"})
    resolved_complaints = await db.complaints.count_documents({"status": "resolved"})

    # Sum invoices + expenses via aggregation (no full document scan)
    inv_agg = await db.invoices.aggregate([
        {"$group": {"_id": "$status", "total": {"$sum": "$amount"}}}
    ]).to_list(10)
    total_collected = 0.0
    total_pending = 0.0
    for g in inv_agg:
        if g["_id"] == "paid":
            total_collected = float(g["total"])
        else:
            total_pending += float(g["total"])
    exp_agg = await db.expenses.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
    ]).to_list(1)
    total_expenses = float(exp_agg[0]["total"]) if exp_agg else 0.0

    active_visitors = await db.visitors.count_documents({"check_out": None})
    announcements_count = await db.announcements.count_documents({})

    today_iso = datetime.now(timezone.utc).date().isoformat()
    bookings_today = await db.bookings.count_documents({"date": today_iso, "status": {"$ne": "cancelled"}})
    bookings_upcoming = await db.bookings.count_documents({"date": {"$gt": today_iso}, "status": {"$ne": "cancelled"}})
    amenities_active = await db.amenities.count_documents({"is_active": True})

    resident_data = {}
    if user["role"] == "resident":
        my_bookings = await db.bookings.count_documents({"user_id": user["id"], "date": {"$gte": today_iso}, "status": {"$ne": "cancelled"}})
        resident_data["my_upcoming_bookings"] = my_bookings
        if user.get("flat_id"):
            my_unpaid = await db.invoices.count_documents({"flat_id": user["flat_id"], "status": "unpaid"})
            my_agg = await db.invoices.aggregate([
                {"$match": {"flat_id": user["flat_id"], "status": "unpaid"}},
                {"$group": {"_id": None, "total": {"$sum": "$amount"}}}
            ]).to_list(1)
            my_pending_amount = float(my_agg[0]["total"]) if my_agg else 0.0
            resident_data["my_unpaid_count"] = my_unpaid
            resident_data["my_pending_amount"] = my_pending_amount

    return {
        "total_flats": total_flats,
        "total_users": total_users,
        "total_residents": total_residents,
        "invoices_unpaid": unpaid,
        "invoices_paid": paid,
        "total_collected": total_collected,
        "total_pending": total_pending,
        "total_expenses": total_expenses,
        "complaints_open": open_complaints,
        "complaints_inprogress": inprogress_complaints,
        "complaints_resolved": resolved_complaints,
        "active_visitors": active_visitors,
        "announcements_count": announcements_count,
        "bookings_today": bookings_today,
        "bookings_upcoming": bookings_upcoming,
        "amenities_active": amenities_active,
        **resident_data,
    }

# ---------- Startup ----------
@app.on_event("startup")
async def startup():
    # Master DB indexes
    await master_db.master_users.create_index("email", unique=True)
    await master_db.master_users.create_index("id", unique=True)
    await master_db.societies.create_index("id", unique=True)
    await master_db.user_index.create_index("email", unique=True)

    # Seed master super-admin
    master_email = os.environ.get("MASTER_ADMIN_EMAIL", "master@maintyn.in").lower()
    master_pw = os.environ.get("MASTER_ADMIN_PASSWORD", "Master@12345")
    existing_master = await master_db.master_users.find_one({"email": master_email})
    if not existing_master:
        await master_db.master_users.insert_one({
            "id": new_id(), "email": master_email, "name": "Maintyn Support",
            "role": "super_admin", "password_hash": hash_password(master_pw),
            "is_active": True, "created_at": now_iso(),
        })
        logger.info(f"Seeded master super-admin: {master_email}")

    # Ensure a Default society exists, wrapping the legacy DB_NAME data (idempotent)
    default_soc = await master_db.societies.find_one({"is_default": True})
    if not default_soc:
        default_id = new_id()
        legacy_db_name = os.environ["DB_NAME"]
        target_db_name = _db_name_for_society(default_id)
        # Move legacy data by renaming (drop target if exists, then rename)
        try:
            existing_collections = await client[legacy_db_name].list_collection_names()
        except Exception:
            existing_collections = []
        default_db_name = target_db_name
        if existing_collections:
            # Copy each collection into the new society DB (avoid renameCollection privileges)
            src_db = client[legacy_db_name]
            dst_db = client[target_db_name]
            for coll_name in existing_collections:
                src = src_db[coll_name]
                dst = dst_db[coll_name]
                async for doc in src.find({}):
                    doc.pop("_id", None)
                    try:
                        await dst.insert_one(doc)
                    except Exception:
                        pass
        # Rebuild user_index from the new society's users
        sdb = client[default_db_name]
        async for u in sdb.users.find({}, {"email": 1, "id": 1}):
            try:
                await master_db.user_index.insert_one({
                    "email": u["email"], "user_id": u["id"], "society_id": default_id, "kind": "society"
                })
            except Exception:
                pass
        await master_db.societies.insert_one({
            "id": default_id,
            "name": os.environ.get("DEFAULT_SOCIETY_NAME", "Default Society"),
            "db_name": default_db_name,
            "status": "active",
            "is_default": True,
            "first_admin_email": os.environ.get("ADMIN_EMAIL", "admin@maintyn.app").lower(),
            "first_admin_name": "Admin",
            "created_at": now_iso(),
        })
        logger.info(f"Migrated legacy data into Default society ({default_id})")
        default_soc = await master_db.societies.find_one({"is_default": True})

    # Seed default society admin (into the Default society DB)
    default_id = default_soc["id"]
    _current_db.set(_get_society_db(default_id))
    await db.users.create_index("email", unique=True)
    await db.users.create_index("id", unique=True)
    await db.flats.create_index("id", unique=True)
    await db.invoices.create_index("id", unique=True); await db.invoices.create_index("flat_id")
    await db.expenses.create_index("id", unique=True)
    await db.complaints.create_index("id", unique=True)
    await db.announcements.create_index("id", unique=True)
    await db.visitors.create_index("id", unique=True)
    await db.files.create_index("id", unique=True)
    await db.password_reset_tokens.create_index("token", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.amenities.create_index("id", unique=True)
    await db.bookings.create_index("id", unique=True); await db.bookings.create_index([("amenity_id", 1), ("date", 1)])
    await db.bookings.create_index("user_id")
    await db.digest_runs.create_index("month", unique=True)
    await db.utility_connections.create_index("id", unique=True); await db.utility_connections.create_index("flat_id")
    await db.utility_bills.create_index("id", unique=True); await db.utility_bills.create_index("flat_id")
    await db.staff.create_index("id", unique=True); await db.staff.create_index("category")

    admin_email = os.environ.get("ADMIN_EMAIL", "admin@maintyn.app").lower()
    admin_pw = os.environ.get("ADMIN_PASSWORD", "Admin@12345")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        u = {
            "id": new_id(), "email": admin_email, "password_hash": hash_password(admin_pw),
            "name": "Admin", "phone": None, "role": "admin", "flat_id": None, "created_at": now_iso(),
        }
        await db.users.insert_one(u)
        try:
            await master_db.user_index.insert_one({"email": admin_email, "user_id": u["id"], "society_id": default_id, "kind": "society"})
        except Exception:
            pass
        logger.info(f"Seeded default-society admin: {admin_email}")

    init_storage()

    if not scheduler.running:
        scheduler.add_job(
            _scheduled_digest,
            CronTrigger(day=1, hour=9, minute=0),
            id="monthly_digest",
            replace_existing=True,
            misfire_grace_time=3600,
        )
        scheduler.start()
        logger.info("Monthly digest scheduler started (cron: day=1 hour=9)")

@app.on_event("shutdown")
async def shutdown():
    if scheduler.running:
        scheduler.shutdown(wait=False)
    client.close()

# Mount split-out route modules onto the api router
import sys as _sys
from routes import staff as _routes_staff, complaints as _routes_complaints, dashboards as _routes_dashboards
_this_module = _sys.modules[__name__]
_routes_staff._mount(_this_module)
_routes_complaints._mount(_this_module)
_routes_dashboards._mount(_this_module)
api.include_router(_routes_staff.router)
api.include_router(_routes_complaints.router)
api.include_router(_routes_dashboards.router)

# Include router & CORS
app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
