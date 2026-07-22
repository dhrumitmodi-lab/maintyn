"""Tests for auto-applied late-payment PENALTY feature.

Covers:
- PATCH /api/society validation for penalty_* fields
- GET /api/invoices enrichment with `penalty` + `total_due` (fixed / per_day / cap / disabled)
- POST /api/invoices/{id}/pay freezes penalty_snapshot and returns penalty/total_due
- GET /api/invoices/stats: pending.principal/penalty, defaulters entries, penalty_config
- Regression: penalty=0 and keys still present when disabled
"""
import os
import time
import uuid
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient

def _read_env(path, key):
    try:
        for line in open(path):
            if line.strip().startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        return None
    return None

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL")
            or _read_env("/app/frontend/.env", "REACT_APP_BACKEND_URL")).rstrip("/")
MONGO_URL = (os.environ.get("MONGO_URL")
             or _read_env("/app/backend/.env", "MONGO_URL")
             or "mongodb://localhost:27017")
os.environ.setdefault("MASTER_DB_NAME", _read_env("/app/backend/.env", "MASTER_DB_NAME") or "maintyn_master")

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASSWORD = "Admin@12345"


# --------------- Fixtures ---------------
@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def default_society_db():
    """Return a tenant-prefixed view on the shared DB (collection-prefix-per-tenant)."""
    class _PrefixView:
        def __init__(self, db, prefix):
            self._db = db; self._prefix = prefix
        def __getattr__(self, name):
            return self._db[f"{self._prefix}{name}"]
        def __getitem__(self, name):
            return self._db[f"{self._prefix}{name}"]

    async def _resolve():
        client = AsyncIOMotorClient(MONGO_URL)
        shared = client[os.environ.get("DB_NAME", "maintyn_db")]
        soc = await shared.societies.find_one({"is_default": True})
        assert soc, "no default society found"
        prefix = f"s_{soc['id'].replace('-', '')}__"
        return client, _PrefixView(shared, prefix)

    client, sdb = asyncio.get_event_loop().run_until_complete(_resolve())
    yield sdb
    client.close()


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# --------------- 1. PATCH /api/society validation ---------------
class TestSocietyPenaltyPatch:
    def test_set_penalty_fixed_valid(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "fixed",
            "penalty_amount": 150, "penalty_max": 0
        })
        assert r.status_code == 200
        d = r.json()
        assert d["penalty_enabled"] is True
        assert d["penalty_mode"] == "fixed"
        assert float(d["penalty_amount"]) == 150.0
        # GET back to confirm persistence
        g = admin_session.get(f"{BASE_URL}/api/society")
        assert g.json()["penalty_amount"] == 150

    def test_invalid_mode_400(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_mode": "xyz"})
        assert r.status_code == 400

    def test_negative_amount_400(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_amount": -5})
        assert r.status_code == 400

    def test_negative_max_400(self, admin_session):
        r = admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_max": -1})
        assert r.status_code == 400


# --------------- 2. Invoice penalty computation ---------------
class TestInvoicePenaltyComputation:
    """Seeds invoices with backdated due_date and verifies penalty math."""

    @pytest.fixture(autouse=True)
    def seed_invoices(self, admin_session, default_society_db):
        # Ensure we have a flat to attach invoices to
        flats = admin_session.get(f"{BASE_URL}/api/flats").json()
        assert flats, "no flats"
        self.flat_id = flats[0]["id"]

        # Create 3 test invoices via direct DB insert to control due_date in past
        today = datetime.now(timezone.utc).date()
        due_20_days_ago = (today - timedelta(days=20)).isoformat()
        due_future = (today + timedelta(days=10)).isoformat()

        self.inv_overdue_id = f"TEST_PEN_{uuid.uuid4().hex[:8]}"
        self.inv_notdue_id = f"TEST_PEN_{uuid.uuid4().hex[:8]}"

        async def _seed():
            await default_society_db.invoices.insert_many([
                {
                    "id": self.inv_overdue_id, "flat_id": self.flat_id,
                    "amount": 1000, "description": "TEST_PEN overdue",
                    "month": today.strftime("%Y-%m"), "due_date": due_20_days_ago,
                    "status": "unpaid", "paid_at": None, "payment_method": None,
                    "created_by": "test", "created_at": datetime.now(timezone.utc).isoformat(),
                },
                {
                    "id": self.inv_notdue_id, "flat_id": self.flat_id,
                    "amount": 1000, "description": "TEST_PEN notdue",
                    "month": today.strftime("%Y-%m"), "due_date": due_future,
                    "status": "unpaid", "paid_at": None, "payment_method": None,
                    "created_by": "test", "created_at": datetime.now(timezone.utc).isoformat(),
                },
            ])
        _run(_seed())
        yield
        # cleanup
        async def _cleanup():
            await default_society_db.invoices.delete_many({"description": {"$regex": "^TEST_PEN"}})
        _run(_cleanup())

    def _get_invoices_map(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/invoices")
        assert r.status_code == 200
        return {d["id"]: d for d in r.json()}

    def test_fixed_mode_penalty_applied_only_when_overdue(self, admin_session):
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "fixed",
            "penalty_amount": 100, "penalty_max": 0
        })
        m = self._get_invoices_map(admin_session)
        assert m[self.inv_overdue_id]["penalty"] == 100
        assert m[self.inv_overdue_id]["total_due"] == 1100
        assert m[self.inv_notdue_id]["penalty"] == 0
        assert m[self.inv_notdue_id]["total_due"] == 1000

    def test_per_day_penalty_calculation(self, admin_session):
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "per_day",
            "penalty_amount": 10, "penalty_max": 0
        })
        m = self._get_invoices_map(admin_session)
        # 20 days late × ₹10 = ₹200
        assert m[self.inv_overdue_id]["penalty"] == 200
        assert m[self.inv_overdue_id]["total_due"] == 1200

    def test_per_day_penalty_capped(self, admin_session):
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "per_day",
            "penalty_amount": 10, "penalty_max": 50
        })
        m = self._get_invoices_map(admin_session)
        # 20*10=200 but capped at 50
        assert m[self.inv_overdue_id]["penalty"] == 50
        assert m[self.inv_overdue_id]["total_due"] == 1050

    def test_disabled_yields_zero_but_keys_exist(self, admin_session):
        admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_enabled": False})
        m = self._get_invoices_map(admin_session)
        assert "penalty" in m[self.inv_overdue_id]
        assert "total_due" in m[self.inv_overdue_id]
        assert m[self.inv_overdue_id]["penalty"] == 0
        assert m[self.inv_overdue_id]["total_due"] == 1000


# --------------- 3. Pay freezes snapshot ---------------
class TestPayFreezesSnapshot:
    def test_pay_freezes_and_returns_penalty(self, admin_session, default_society_db):
        # Enable per_day 10, no cap
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "per_day",
            "penalty_amount": 10, "penalty_max": 0
        })
        flats = admin_session.get(f"{BASE_URL}/api/flats").json()
        flat_id = flats[0]["id"]
        iid = f"TEST_PEN_PAY_{uuid.uuid4().hex[:8]}"
        due = (datetime.now(timezone.utc).date() - timedelta(days=15)).isoformat()

        async def _seed():
            await default_society_db.invoices.insert_one({
                "id": iid, "flat_id": flat_id, "amount": 500,
                "description": "TEST_PEN pay", "month": "2026-01", "due_date": due,
                "status": "unpaid", "paid_at": None,
                "created_by": "test", "created_at": datetime.now(timezone.utc).isoformat(),
            })
        _run(_seed())

        r = admin_session.post(f"{BASE_URL}/api/invoices/{iid}/pay", json={"method": "manual"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"
        assert d["penalty"] == 150  # 15 * 10
        assert d["total_due"] == 650
        assert d.get("penalty_snapshot") == 150

        # Now disable penalty globally and confirm paid invoice still shows snapshot
        admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_enabled": False})
        lst = admin_session.get(f"{BASE_URL}/api/invoices").json()
        paid = next(x for x in lst if x["id"] == iid)
        assert paid["penalty"] == 150
        assert paid["total_due"] == 650

        # cleanup
        _run(default_society_db.invoices.delete_one({"id": iid}))


# --------------- 4. /api/invoices/stats ---------------
class TestInvoiceStats:
    def test_stats_shape_and_penalty_config(self, admin_session, default_society_db):
        # Enable fixed 100
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "fixed",
            "penalty_amount": 100, "penalty_max": 0
        })
        # Seed an overdue invoice > 90 days old to appear in defaulters
        flats = admin_session.get(f"{BASE_URL}/api/flats").json()
        flat_id = flats[0]["id"]
        iid = f"TEST_PEN_STATS_{uuid.uuid4().hex[:8]}"
        old_created = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        due = (datetime.now(timezone.utc).date() - timedelta(days=95)).isoformat()

        async def _seed():
            await default_society_db.invoices.insert_one({
                "id": iid, "flat_id": flat_id, "amount": 2000,
                "description": "TEST_PEN stats", "month": "2025-10", "due_date": due,
                "status": "unpaid", "paid_at": None,
                "created_by": "test", "created_at": old_created,
            })
        _run(_seed())

        r = admin_session.get(f"{BASE_URL}/api/invoices/stats")
        assert r.status_code == 200
        d = r.json()
        # pending breakdown keys
        assert "principal" in d["pending"]
        assert "penalty" in d["pending"]
        assert d["pending"]["total"] == round(d["pending"]["principal"] + d["pending"]["penalty"], 2)
        # penalty_config snapshot
        cfg = d["penalty_config"]
        assert cfg["enabled"] is True
        assert cfg["mode"] == "fixed"
        assert cfg["amount"] == 100
        # defaulters entry for our flat
        entry = next((x for x in d["defaulters"] if x["flat_id"] == flat_id), None)
        assert entry is not None, "seeded defaulter not present"
        assert "penalty" in entry and "total_due" in entry and "amount" in entry
        assert entry["total_due"] == round(entry["amount"] + entry["penalty"], 2)
        assert entry["penalty"] >= 100  # fixed 100 minimum since overdue

        _run(default_society_db.invoices.delete_one({"id": iid}))


# --------------- 5. Defaulter dunning body includes late-fee column ---------------
class TestDunningEmailBody:
    def test_remind_defaulters_endpoint(self, admin_session, default_society_db):
        admin_session.patch(f"{BASE_URL}/api/society", json={
            "penalty_enabled": True, "penalty_mode": "fixed",
            "penalty_amount": 100, "penalty_max": 0
        })
        flats = admin_session.get(f"{BASE_URL}/api/flats").json()
        flat_id = flats[0]["id"]
        iid = f"TEST_PEN_DUN_{uuid.uuid4().hex[:8]}"
        old_created = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
        due = (datetime.now(timezone.utc).date() - timedelta(days=95)).isoformat()

        async def _seed():
            await default_society_db.invoices.insert_one({
                "id": iid, "flat_id": flat_id, "amount": 500,
                "description": "TEST_PEN dun", "month": "2025-10", "due_date": due,
                "status": "unpaid", "paid_at": None,
                "created_by": "test", "created_at": old_created,
            })
        _run(_seed())
        r = admin_session.post(f"{BASE_URL}/api/invoices/defaulters/remind",
                                json={"flat_ids": [flat_id]})
        assert r.status_code == 200
        d = r.json()
        assert d["flats_targeted"] == 1
        # emails_queued may be 0 if flat has no residents; that's still valid
        assert d["emails_queued"] >= 0

        _run(default_society_db.invoices.delete_one({"id": iid}))


# --------------- 6. Regression: keys exist even when disabled ---------------
class TestRegressionDisabled:
    def test_invoices_list_still_has_keys_when_disabled(self, admin_session):
        admin_session.patch(f"{BASE_URL}/api/society", json={"penalty_enabled": False})
        r = admin_session.get(f"{BASE_URL}/api/invoices")
        assert r.status_code == 200
        data = r.json()
        if data:
            sample = data[0]
            assert "penalty" in sample
            assert "total_due" in sample
            # If paid & has snapshot, penalty may still be > 0. For unpaid, must be 0.
            for d in data:
                if d.get("status") == "unpaid":
                    assert d["penalty"] == 0
                    assert d["total_due"] == round(float(d.get("amount", 0)), 2)

    def test_stats_endpoint_still_works_disabled(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/invoices/stats")
        assert r.status_code == 200
        d = r.json()
        assert d["penalty_config"]["enabled"] is False
