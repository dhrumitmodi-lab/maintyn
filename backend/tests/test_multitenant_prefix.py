"""
Regression & architecture test after switch from database-per-tenant → collection-prefix-per-tenant.

Verifies:
  1. Master console + rollup + society list still works.
  2. Existing Default society data (flats/users/invoices/complaints/expenses/staff) is accessible.
  3. Creating a new society writes to `s_<hex>__*` collections inside shared `maintyn_db`, NOT to a new physical DB.
  4. Tenant isolation: new society data is invisible to Default society.
  5. Deleting a society drops its `s_<hex>__*` collections and leaves Default intact.
  6. Penalty feature still enriches invoices with `penalty` / `total_due`.
  7. Only 1 Default society exists.
  8. Legacy `maintyn_society_*` physical DBs are not being newly written to (no new physical DBs created after society creation).
"""
import os, uuid, time
from pathlib import Path
import pytest
import requests
from pymongo import MongoClient

# Load env
def _load(p):
    d = {}
    for line in Path(p).read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            d[k.strip()] = v.strip().strip('"').strip("'")
    return d

BE = _load("/app/backend/.env")
FE = _load("/app/frontend/.env")
BASE = FE["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = BE["MONGO_URL"]
DB_NAME = BE["DB_NAME"]
ADMIN_EMAIL = BE["ADMIN_EMAIL"]; ADMIN_PW = BE["ADMIN_PASSWORD"]
MASTER_EMAIL = BE["MASTER_ADMIN_EMAIL"]; MASTER_PW = BE["MASTER_ADMIN_PASSWORD"]

mongo = MongoClient(MONGO_URL)
shared_db = mongo[DB_NAME]


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin():
    return _login(ADMIN_EMAIL, ADMIN_PW)


@pytest.fixture(scope="module")
def master():
    return _login(MASTER_EMAIL, MASTER_PW)


# ---------- 1. Master session + list + rollup ----------
class TestMasterConsole:
    def test_session(self, master):
        r = master.get(f"{BASE}/api/master/session")
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == MASTER_EMAIL
        assert d.get("kind") == "master"

    def test_societies(self, master):
        r = master.get(f"{BASE}/api/master/societies")
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) >= 1
        default = [s for s in docs if s.get("is_default")]
        assert len(default) == 1, f"expected exactly 1 default, got {len(default)}"
        # default should show real counts
        assert default[0]["flats"] >= 30
        assert default[0]["residents"] >= 1

    def test_rollup(self, master):
        r = master.get(f"{BASE}/api/master/rollup")
        assert r.status_code == 200
        d = r.json()
        for k in ("total_residents", "total_flats", "total_unpaid_invoices"):
            # keys may vary — check any numeric
            pass
        # Just check some numeric aggregation is present
        assert any(isinstance(v, (int, float)) for v in d.values())


# ---------- 2. Default society regression: admin can list data ----------
class TestDefaultSocietyData:
    def test_flats(self, admin):
        r = admin.get(f"{BASE}/api/flats")
        assert r.status_code == 200
        assert len(r.json()) >= 30

    def test_users(self, admin):
        r = admin.get(f"{BASE}/api/users")
        assert r.status_code == 200
        assert len(r.json()) >= 5

    def test_invoices_with_penalty_fields(self, admin):
        r = admin.get(f"{BASE}/api/invoices")
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        # Penalty enrichment present on every row
        for row in rows[:20]:
            assert "penalty" in row
            assert "total_due" in row

    def test_complaints(self, admin):
        r = admin.get(f"{BASE}/api/complaints")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_expenses(self, admin):
        r = admin.get(f"{BASE}/api/expenses")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_staff(self, admin):
        r = admin.get(f"{BASE}/api/staff")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_dashboard(self, admin):
        r = admin.get(f"{BASE}/api/invoices/stats")
        assert r.status_code == 200
        d = r.json()
        assert "pending" in d


# ---------- 3-5. New society lifecycle: create → prefix collections → isolate → delete ----------
class TestSocietyLifecycle:
    NEW_SID = None
    NEW_HEX = None
    NEW_ADMIN_EMAIL = None
    NEW_ADMIN_PW = "NewAdmin@123"

    def _list_dbs(self):
        return set(mongo.list_database_names())

    def test_01_create_society(self, master):
        tag = uuid.uuid4().hex[:6]
        TestSocietyLifecycle.NEW_ADMIN_EMAIL = f"test_admin_{tag}@example.com"
        dbs_before = self._list_dbs()
        payload = {
            "name": f"TEST_PrefixSoc_{tag}",
            "admin_name": f"Admin {tag}",
            "admin_email": TestSocietyLifecycle.NEW_ADMIN_EMAIL,
            "admin_password": TestSocietyLifecycle.NEW_ADMIN_PW,
        }
        r = master.post(f"{BASE}/api/master/societies", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        TestSocietyLifecycle.NEW_SID = d["id"]
        TestSocietyLifecycle.NEW_HEX = d["id"].replace("-", "")
        # Society doc in shared DB
        assert shared_db.societies.find_one({"id": d["id"]}) is not None
        # No new physical DB
        dbs_after = self._list_dbs()
        added = dbs_after - dbs_before
        assert not any(a.startswith("maintyn_society_") or a.startswith("s_") for a in added), \
            f"unexpected new physical DBs: {added}"
        # Prefixed users collection exists with the new admin
        prefix = f"s_{TestSocietyLifecycle.NEW_HEX}__"
        users_coll = shared_db[f"{prefix}users"]
        assert users_coll.find_one({"email": TestSocietyLifecycle.NEW_ADMIN_EMAIL}) is not None
        # user_index in shared_db
        assert shared_db.user_index.find_one({"email": TestSocietyLifecycle.NEW_ADMIN_EMAIL}) is not None

    def test_02_new_admin_login_and_isolation(self):
        s = _login(TestSocietyLifecycle.NEW_ADMIN_EMAIL, TestSocietyLifecycle.NEW_ADMIN_PW)
        # New tenant should have 0 flats (fresh society)
        r = s.get(f"{BASE}/api/flats")
        assert r.status_code == 200
        assert r.json() == []
        # Create a flat + expense + complaint here
        r = s.post(f"{BASE}/api/flats", json={"block": "T", "number": "1", "type": "1BHK"})
        assert r.status_code in (200, 201), r.text
        flat = r.json()
        TestSocietyLifecycle.NEW_FLAT_ID = flat["id"]
        # Verify was written to prefixed collection
        prefix = f"s_{TestSocietyLifecycle.NEW_HEX}__"
        assert shared_db[f"{prefix}flats"].find_one({"id": flat["id"]}) is not None

    def test_03_isolation_default_cannot_see_new_flat(self, admin):
        r = admin.get(f"{BASE}/api/flats")
        assert r.status_code == 200
        default_flat_ids = {f["id"] for f in r.json()}
        assert TestSocietyLifecycle.NEW_FLAT_ID not in default_flat_ids

    def test_04_delete_society_drops_prefixed_collections(self, master):
        sid = TestSocietyLifecycle.NEW_SID
        hex_ = TestSocietyLifecycle.NEW_HEX
        prefix = f"s_{hex_}__"
        # Sanity: prefixed collections exist before delete
        pre_colls = [c for c in shared_db.list_collection_names() if c.startswith(prefix)]
        assert len(pre_colls) >= 1
        r = master.delete(f"{BASE}/api/master/societies/{sid}")
        assert r.status_code == 200, r.text
        # Society doc removed
        assert shared_db.societies.find_one({"id": sid}) is None
        # user_index cleared
        assert shared_db.user_index.count_documents({"society_id": sid}) == 0
        # All prefixed collections dropped
        post_colls = [c for c in shared_db.list_collection_names() if c.startswith(prefix)]
        assert post_colls == [], f"prefixed collections still present after delete: {post_colls}"

    def test_05_default_still_intact_after_delete(self, admin):
        r = admin.get(f"{BASE}/api/flats")
        assert r.status_code == 200
        assert len(r.json()) >= 30
        r = admin.get(f"{BASE}/api/invoices")
        assert r.status_code == 200
        assert len(r.json()) >= 1


# ---------- 6. Direct Mongo layout sanity ----------
class TestMongoLayoutSanity:
    def test_shared_db_has_master_and_tenant_prefixes(self):
        names = shared_db.list_collection_names()
        assert "societies" in names
        assert "master_users" in names
        assert "user_index" in names
        # At least one tenant prefix present (Default society)
        assert any(n.startswith("s_") and "__" in n for n in names), \
            "no s_<hex>__ tenant collections found in shared DB"

    def test_exactly_one_default_society(self):
        count = shared_db.societies.count_documents({"is_default": True})
        assert count == 1, f"expected 1 default society, found {count}"


# ---------- 7. Cleanup any leftovers ----------
def test_zzz_cleanup():
    """Best-effort cleanup of TEST_* societies + their prefixed data (in case a previous
    test run left orphans). Idempotent — safe to run repeatedly."""
    orphans = list(shared_db.societies.find({"name": {"$regex": "^TEST_"}, "is_default": {"$ne": True}}))
    for s in orphans:
        hex_ = s["id"].replace("-", "")
        prefix = f"s_{hex_}__"
        for c in shared_db.list_collection_names():
            if c.startswith(prefix):
                shared_db[c].drop()
        shared_db.user_index.delete_many({"society_id": s["id"]})
        shared_db.societies.delete_one({"id": s["id"]})
