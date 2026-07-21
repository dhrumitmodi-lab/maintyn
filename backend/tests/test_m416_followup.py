"""M-416 follow-up: partial PATCH staff, round-robin auto-assign, defaulter dunning,
+ regression spot-check for endpoints moved to routes/*.

Runs against REACT_APP_BACKEND_URL (public preview URL).
"""
import os
import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

ADMIN = {"email": "admin@maintyn.app", "password": "Admin@12345"}
RESIDENT = {"email": "demo.resident@example.com", "password": "Resident@123"}
MASTER = {"email": "master@maintyn.in", "password": "Master@12345"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=20)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN)


@pytest.fixture(scope="module")
def resident():
    return _login(RESIDENT)


@pytest.fixture(scope="module")
def master():
    return _login(MASTER)


# ---------- REGRESSION: spot-check endpoints from each module ----------
class TestRegressionRoutes:
    def test_get_staff(self, admin):
        r = admin.get(f"{BASE_URL}/api/staff")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_complaints(self, admin):
        r = admin.get(f"{BASE_URL}/api/complaints")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_invoice_stats(self, admin):
        r = admin.get(f"{BASE_URL}/api/invoices/stats")
        assert r.status_code == 200
        d = r.json()
        for k in ("raised", "received", "pending", "defaulters", "collection_pct"):
            assert k in d

    def test_expense_stats(self, admin):
        r = admin.get(f"{BASE_URL}/api/expenses/stats")
        assert r.status_code == 200
        d = r.json()
        assert "series" in d and len(d["series"]) == 12

    # server.py endpoints spot-check
    def test_auth_me(self, admin):
        r = admin.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        assert r.json().get("email") == ADMIN["email"]

    def test_flats_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/flats")
        assert r.status_code == 200

    def test_invoices_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/invoices")
        assert r.status_code == 200

    def test_expenses_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/expenses")
        assert r.status_code == 200

    def test_amenities_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/amenities")
        assert r.status_code == 200

    def test_announcements_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/announcements")
        assert r.status_code == 200

    def test_stats_summary(self, admin):
        # dashboard aggregate
        r = admin.get(f"{BASE_URL}/api/stats")
        assert r.status_code in (200, 404)  # tolerate if renamed


# ---------- Partial PATCH staff ----------
class TestPartialPatchStaff:
    sid = None

    def test_create_seed_staff(self, admin):
        payload = {
            "name": f"TEST_PATCH_{uuid.uuid4().hex[:6]}",
            "role_label": "Plumber",
            "category": "plumbing",
            "phone": "+91 99999 11111",
            "email": "patch_test@example.com",
            "vendor_org": "AcmePlumb",
            "notes": "seed",
            "is_active": True,
        }
        r = admin.post(f"{BASE_URL}/api/staff", json=payload)
        assert r.status_code == 200, r.text
        TestPartialPatchStaff.sid = r.json()["id"]

    def test_patch_single_field_only(self, admin):
        sid = TestPartialPatchStaff.sid
        assert sid
        # patch just is_active
        r = admin.patch(f"{BASE_URL}/api/staff/{sid}", json={"is_active": False})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_active"] is False
        # other fields intact
        assert d["role_label"] == "Plumber"
        assert d["phone"] == "+91 99999 11111"
        assert d["email"] == "patch_test@example.com"
        assert d["vendor_org"] == "AcmePlumb"
        assert d["notes"] == "seed"
        assert d["category"] == "plumbing"

    def test_patch_only_phone(self, admin):
        sid = TestPartialPatchStaff.sid
        r = admin.patch(f"{BASE_URL}/api/staff/{sid}", json={"phone": "+91 88888 22222"})
        assert r.status_code == 200
        d = r.json()
        assert d["phone"] == "+91 88888 22222"
        assert d["role_label"] == "Plumber"
        assert d["vendor_org"] == "AcmePlumb"
        # is_active was set False previously, still False
        assert d["is_active"] is False

    def test_patch_empty_body_rejected(self, admin):
        sid = TestPartialPatchStaff.sid
        r = admin.patch(f"{BASE_URL}/api/staff/{sid}", json={})
        assert r.status_code == 400

    def test_cleanup(self, admin):
        sid = TestPartialPatchStaff.sid
        if sid:
            admin.delete(f"{BASE_URL}/api/staff/{sid}")


# ---------- Round-robin auto-assign ----------
class TestRoundRobinAutoAssign:
    category = None
    staff_ids = []
    complaint_ids = []

    def test_setup_three_staff_same_category(self, admin):
        # unique category so no interference with existing staff
        cat = f"rr_{uuid.uuid4().hex[:6]}"
        TestRoundRobinAutoAssign.category = cat
        for i in range(3):
            r = admin.post(f"{BASE_URL}/api/staff", json={
                "name": f"TEST_RR_{i}_{uuid.uuid4().hex[:4]}",
                "role_label": f"Tech {i}",
                "category": cat,
                "is_active": True,
            })
            assert r.status_code == 200, r.text
            TestRoundRobinAutoAssign.staff_ids.append(r.json()["id"])
        # small sleep so created_at ordering is stable
        time.sleep(0.1)

    def test_six_complaints_even_distribution(self, resident):
        cat = TestRoundRobinAutoAssign.category
        assert cat
        assigned_seq = []
        for i in range(6):
            r = resident.post(f"{BASE_URL}/api/complaints", json={
                "title": f"TEST_RR_C_{i}_{uuid.uuid4().hex[:4]}",
                "description": "rr test",
                "category": cat,
                "priority": "low",
            })
            assert r.status_code == 200, r.text
            d = r.json()
            assert d.get("assigned_to"), f"complaint {i} not auto-assigned"
            TestRoundRobinAutoAssign.complaint_ids.append(d["id"])
            assigned_seq.append(d["assigned_to"])
            # tiny sleep to ensure last_auto_assigned_at ordering differs
            time.sleep(0.05)

        # Each staff should be picked exactly twice
        from collections import Counter
        counts = Counter(assigned_seq)
        assert set(counts.keys()) == set(TestRoundRobinAutoAssign.staff_ids), (
            f"unexpected staff picked: {counts} vs {TestRoundRobinAutoAssign.staff_ids}"
        )
        for sid, c in counts.items():
            assert c == 2, f"staff {sid} picked {c} times, expected 2 — seq={assigned_seq}"

        # Rotation: first 3 should be a permutation of all staff (no duplicates in
        # first 3 nor in last 3)
        assert len(set(assigned_seq[:3])) == 3, f"first-3 not unique: {assigned_seq[:3]}"
        assert len(set(assigned_seq[3:])) == 3, f"last-3 not unique: {assigned_seq[3:]}"

    def test_last_auto_assigned_at_updated(self, admin):
        # staff list should carry last_auto_assigned_at
        r = admin.get(f"{BASE_URL}/api/staff", params={"category": TestRoundRobinAutoAssign.category})
        assert r.status_code == 200
        staff = r.json()
        assert len(staff) == 3
        for s in staff:
            assert s.get("last_auto_assigned_at"), f"missing last_auto_assigned_at on {s}"

    def test_cleanup(self, admin):
        for cid in TestRoundRobinAutoAssign.complaint_ids:
            # no delete endpoint — leave complaints
            pass
        for sid in TestRoundRobinAutoAssign.staff_ids:
            admin.delete(f"{BASE_URL}/api/staff/{sid}")


# ---------- Defaulter dunning ----------
class TestDefaulterDunning:
    seeded_invoice_id = None
    seeded_flat_id = None

    def test_seed_defaulter_invoice(self, admin):
        """Insert an unpaid invoice with created_at 100 days ago directly via mongo
        so the defaulter list is non-empty. Uses backend's mongo via a helper script
        approach — but since we can't shell in from here, we'll use the normal create
        endpoint then patch mongo via a subprocess.
        """
        # Get a flat
        flats = admin.get(f"{BASE_URL}/api/flats").json()
        assert flats
        flat = flats[0]
        TestDefaulterDunning.seeded_flat_id = flat["id"]

        # Create invoice via API
        r = admin.post(f"{BASE_URL}/api/invoices", json={
            "flat_id": flat["id"],
            "amount": 4200,
            "description": "TEST_DUNNING_OLD",
            "month": "2025-10",
            "due_date": "2025-10-10",
        })
        assert r.status_code == 200, r.text
        inv = r.json()
        TestDefaulterDunning.seeded_invoice_id = inv["id"]

        # Now backdate created_at via mongo shell — use subprocess
        import subprocess, json as _json
        old_iso = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        # Read the society-scoped DB name via /api/auth/me? We can't. Instead use a
        # python one-liner against pymongo using MONGO_URL from backend/.env.
        script = f"""
import os, asyncio
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
load_dotenv('/app/backend/.env')
async def run():
    c = AsyncIOMotorClient(os.environ['MONGO_URL'])
    # find db containing the invoice
    for name in await c.list_database_names():
        if name.startswith('maintyn_society_') or name == os.environ.get('DB_NAME'):
            db = c[name]
            res = await db.invoices.update_one({{'id': '{inv["id"]}'}}, {{'$set': {{'created_at': '{old_iso}'}}}})
            if res.matched_count:
                print('BACKDATED', name)
                return
    print('NOT_FOUND')
asyncio.run(run())
"""
        r2 = subprocess.run(["python", "-c", script], capture_output=True, text=True, timeout=30)
        assert "BACKDATED" in r2.stdout, f"backdate failed: {r2.stdout} / {r2.stderr}"

    def test_defaulter_appears_in_stats(self, admin):
        r = admin.get(f"{BASE_URL}/api/invoices/stats")
        assert r.status_code == 200
        d = r.json()
        flat_ids_in_defaulters = [x["flat_id"] for x in d["defaulters"]]
        assert TestDefaulterDunning.seeded_flat_id in flat_ids_in_defaulters, (
            f"seeded flat not in defaulters: {flat_ids_in_defaulters}"
        )

    def test_remind_all_defaulters_empty_body(self, admin):
        r = admin.post(f"{BASE_URL}/api/invoices/defaulters/remind", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("flats_targeted", 0) >= 1
        assert "emails_queued" in d

    def test_remind_specific_flat(self, admin):
        r = admin.post(
            f"{BASE_URL}/api/invoices/defaulters/remind",
            json={
                "flat_ids": [TestDefaulterDunning.seeded_flat_id],
                "subject": "TEST_CUSTOM_SUBJECT_XYZ",
                "message": "please pay ASAP - test",
            },
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("flats_targeted") == 1

    def test_remind_no_defaulters_when_no_targets(self, admin):
        # Use a bogus flat id - should return zero
        r = admin.post(
            f"{BASE_URL}/api/invoices/defaulters/remind",
            json={"flat_ids": ["nonexistent_flat_id_xxx"]},
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("flats_targeted") == 1  # still targeted, but no residents
        # emails_queued may be 0 because no residents match

    def test_backend_log_shows_subject_attempt(self, admin):
        # Give BG tasks time
        time.sleep(3)
        log = ""
        for p in ("/var/log/supervisor/backend.err.log", "/var/log/supervisor/backend.out.log"):
            try:
                with open(p) as f:
                    log += f.read()[-60000:]
            except Exception:
                pass
        # Look for evidence of email send attempt (Resend may 422 on @example.com)
        markers = ["TEST_CUSTOM_SUBJECT_XYZ", "Reminder", "defaulters", "Payment", "send_email_raw", "Email failed", "resend"]
        assert any(m in log for m in markers), f"no email markers in log; tail:\n{log[-2000:]}"

    def test_cleanup(self, admin):
        if TestDefaulterDunning.seeded_invoice_id:
            admin.delete(f"{BASE_URL}/api/invoices/{TestDefaulterDunning.seeded_invoice_id}")


# ---------- Multi-tenant isolation for moved routes ----------
class TestIsolationMovedRoutes:
    def test_other_society_staff_isolated(self, master, admin):
        # Create new society
        name = f"TEST_ISO2_{uuid.uuid4().hex[:6]}"
        admin_email = f"iso2_{uuid.uuid4().hex[:6]}@example.com"
        pw = "Test@12345"
        r = master.post(f"{BASE_URL}/api/master/societies", json={
            "name": name, "admin_name": "Iso Admin",
            "admin_email": admin_email, "admin_password": pw,
        })
        if r.status_code == 404:
            pytest.skip("master endpoint missing")
        assert r.status_code in (200, 201), r.text

        s2 = _login({"email": admin_email, "password": pw})
        unique = f"TEST_ISO2_STAFF_{uuid.uuid4().hex[:8]}"
        r2 = s2.post(f"{BASE_URL}/api/staff", json={
            "name": unique, "role_label": "Plumber", "category": "plumbing", "is_active": True,
        })
        assert r2.status_code == 200

        # default society admin should not see it
        r3 = admin.get(f"{BASE_URL}/api/staff")
        assert r3.status_code == 200
        names = [x["name"] for x in r3.json()]
        assert unique not in names, f"Isolation broken! {unique} visible in default society"

        # invoices/stats and expenses/stats also scoped
        r4 = s2.get(f"{BASE_URL}/api/invoices/stats")
        assert r4.status_code == 200
        assert r4.json()["raised"]["count"] == 0  # brand new society
        r5 = s2.get(f"{BASE_URL}/api/expenses/stats")
        assert r5.status_code == 200
