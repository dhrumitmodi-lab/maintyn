"""Iteration 9 — Master DB / Multi-tenant tests."""
import os
import time
import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL")
        or open("/app/frontend/.env").read().split("REACT_APP_BACKEND_URL=")[1].split("\n")[0].strip()
       ).rstrip("/")
API = f"{BASE}/api"

MASTER_EMAIL = "master@maintyn.in"
MASTER_PASS = "Master@12345"
DEFAULT_ADMIN = "admin@maintyn.app"
DEFAULT_PASS = "Admin@12345"


def _login(email, pw):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    return r


@pytest.fixture(scope="module")
def master_token():
    r = _login(MASTER_EMAIL, MASTER_PASS)
    assert r.status_code == 200, f"master login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("kind") == "master", f"expected kind=master, got {data}"
    return data["access_token"]


@pytest.fixture(scope="module")
def default_admin_token():
    r = _login(DEFAULT_ADMIN, DEFAULT_PASS)
    assert r.status_code == 200, f"default admin login failed: {r.text}"
    data = r.json()
    assert data.get("kind") == "society"
    assert data.get("society_name") == "Default Society"
    assert data.get("society_id")
    return data["access_token"], data["society_id"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Login / kind tests ----------

def test_master_login_kind():
    r = _login(MASTER_EMAIL, MASTER_PASS)
    assert r.status_code == 200
    assert r.json()["kind"] == "master"


def test_default_admin_login_kind():
    r = _login(DEFAULT_ADMIN, DEFAULT_PASS)
    assert r.status_code == 200
    j = r.json()
    assert j["kind"] == "society"
    assert j["society_name"] == "Default Society"


def test_master_auth_me_401_ignored(master_token):
    """/api/auth/me should NOT succeed with master token (401 or so)."""
    r = requests.get(f"{API}/auth/me", headers=_h(master_token))
    # Spec says 401 or at least ignored (not returning master identity as regular user)
    assert r.status_code in (401, 403), f"got {r.status_code}: {r.text[:200]}"


def test_master_session_works(master_token):
    r = requests.get(f"{API}/master/session", headers=_h(master_token))
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("kind") == "master" or j.get("email") == MASTER_EMAIL


# ---------- Data preservation (migration) ----------

def test_default_society_preserved(default_admin_token):
    token, sid = default_admin_token
    fr = requests.get(f"{API}/flats", headers=_h(token))
    assert fr.status_code == 200, fr.text
    flats = fr.json()
    assert isinstance(flats, list)
    assert len(flats) >= 33, f"expected >=33 flats after migration, got {len(flats)}"

    ur = requests.get(f"{API}/users", headers=_h(token))
    assert ur.status_code == 200, ur.text
    users = ur.json()
    assert len(users) >= 24, f"expected >=24 users, got {len(users)}"


# ---------- Societies listing / rollup ----------

def test_master_list_societies(master_token):
    r = requests.get(f"{API}/master/societies", headers=_h(master_token))
    assert r.status_code == 200, r.text
    lst = r.json()
    assert isinstance(lst, list)
    assert len(lst) >= 1
    default = [s for s in lst if s.get("name", "").lower().startswith("default")]
    assert default, f"no Default society in list: {lst}"
    d = default[0]
    for k in ("residents", "flats", "unpaid_invoices"):
        assert k in d, f"missing key {k} in {d}"


def test_master_rollup(master_token):
    r = requests.get(f"{API}/master/rollup", headers=_h(master_token))
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("societies", "total_residents", "total_flats",
              "total_unpaid_invoices", "total_pending_amount"):
        assert k in j, f"missing {k} in rollup {j}"
    assert j["total_flats"] >= 33


# ---------- Non-super-admin create-society blocked ----------
# We'll first create a support agent via master users CRUD, then test 403

@pytest.fixture(scope="module")
def support_agent_token(master_token):
    # Create support agent
    email = f"TEST_support_{int(time.time())}@maintyn.in"
    pw = "Support@12345"
    r = requests.post(f"{API}/master/users", headers=_h(master_token),
                      json={"email": email, "password": pw, "name": "Test Support",
                            "role": "support"})
    if r.status_code not in (200, 201):
        pytest.skip(f"cannot create support agent: {r.status_code} {r.text}")
    uid = r.json().get("id")
    lr = _login(email, pw)
    if lr.status_code != 200:
        pytest.skip(f"support agent login failed {lr.text}")
    yield lr.json()["access_token"], uid, email
    # cleanup
    if uid:
        requests.delete(f"{API}/master/users/{uid}", headers=_h(master_token))


def test_support_cannot_create_society(support_agent_token):
    token, _, _ = support_agent_token
    r = requests.post(f"{API}/master/societies", headers=_h(token),
                      json={"name": "TEST_ShouldFail",
                            "admin_email": "shouldfail@example.com",
                            "admin_name": "X", "admin_password": "Xx@12345"})
    assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# ---------- Create society + isolation + suspend + delete ----------

@pytest.fixture(scope="module")
def new_society(master_token):
    ts = int(time.time())
    payload = {
        "name": f"TEST_Society_{ts}",
        "admin_email": f"TEST_admin_{ts}@example.com",
        "admin_name": "Test Admin",
        "admin_password": "TestAdm@2026",
    }
    r = requests.post(f"{API}/master/societies", headers=_h(master_token), json=payload)
    assert r.status_code in (200, 201), f"create society failed: {r.status_code} {r.text}"
    j = r.json()
    sid = j.get("id") or j.get("society_id") or j.get("_id")
    assert sid, f"no id in response: {j}"
    yield sid, payload
    # Ensure cleanup
    requests.delete(f"{API}/master/societies/{sid}", headers=_h(master_token))


def test_new_society_admin_login_isolated(new_society):
    sid, payload = new_society
    r = _login(payload["admin_email"], payload["admin_password"])
    assert r.status_code == 200, f"new admin login failed: {r.text}"
    j = r.json()
    assert j["kind"] == "society"
    assert j.get("society_id") == sid, f"expected sid {sid}, got {j.get('society_id')}"
    tok = j["access_token"]
    # Flats should be empty
    fr = requests.get(f"{API}/flats", headers=_h(tok))
    assert fr.status_code == 200
    assert fr.json() == [] or len(fr.json()) == 0
    # Users should contain only the admin
    ur = requests.get(f"{API}/users", headers=_h(tok))
    assert ur.status_code == 200
    users = ur.json()
    assert len(users) == 1, f"expected 1 user, got {len(users)}: {users}"
    assert users[0]["email"].lower() == payload["admin_email"].lower()


def test_suspend_and_restore(master_token, new_society):
    sid, payload = new_society
    # Suspend
    r = requests.patch(f"{API}/master/societies/{sid}/status",
                       headers=_h(master_token), json={"status": "suspended"})
    assert r.status_code == 200, r.text
    lr = _login(payload["admin_email"], payload["admin_password"])
    assert lr.status_code == 403, f"suspended login should 403, got {lr.status_code} {lr.text}"
    # Restore
    r = requests.patch(f"{API}/master/societies/{sid}/status",
                       headers=_h(master_token), json={"status": "active"})
    assert r.status_code == 200
    lr2 = _login(payload["admin_email"], payload["admin_password"])
    assert lr2.status_code == 200


def test_impersonate(master_token, new_society):
    sid, payload = new_society
    r = requests.post(f"{API}/master/societies/{sid}/impersonate",
                      headers=_h(master_token))
    assert r.status_code == 200, r.text
    tok = r.json().get("access_token")
    assert tok
    fr = requests.get(f"{API}/flats", headers=_h(tok))
    assert fr.status_code == 200
    # New society has no flats
    assert len(fr.json()) == 0


def test_cannot_delete_default(master_token):
    lst = requests.get(f"{API}/master/societies", headers=_h(master_token)).json()
    default = [s for s in lst if s.get("name", "").lower().startswith("default")][0]
    sid = default.get("id") or default.get("_id") or default.get("society_id")
    r = requests.delete(f"{API}/master/societies/{sid}", headers=_h(master_token))
    assert r.status_code == 400, f"expected 400 for default delete, got {r.status_code}: {r.text}"


# ---------- Data isolation: default admin still sees own data ----------

def test_default_admin_isolation(default_admin_token, new_society):
    token, _ = default_admin_token
    fr = requests.get(f"{API}/flats", headers=_h(token))
    assert fr.status_code == 200
    assert len(fr.json()) >= 33  # still has own data


# ---------- Master users CRUD ----------

def test_master_users_crud(master_token):
    ts = int(time.time())
    email = f"TEST_agent_{ts}@maintyn.in"
    r = requests.post(f"{API}/master/users", headers=_h(master_token),
                      json={"email": email, "password": "Agent@12345",
                            "name": "Agent Y", "role": "support"})
    assert r.status_code in (200, 201), r.text
    uid = r.json().get("id")
    assert uid
    # List
    lst = requests.get(f"{API}/master/users", headers=_h(master_token)).json()
    assert any(u.get("id") == uid or u.get("email") == email for u in lst)
    # Patch
    p = requests.patch(f"{API}/master/users/{uid}", headers=_h(master_token),
                       json={"is_active": False})
    assert p.status_code == 200, p.text
    # Delete
    d = requests.delete(f"{API}/master/users/{uid}", headers=_h(master_token))
    assert d.status_code in (200, 204)


def test_master_cannot_delete_self(master_token):
    # find self id
    lst = requests.get(f"{API}/master/users", headers=_h(master_token)).json()
    self_row = next((u for u in lst if u.get("email") == MASTER_EMAIL), None)
    if not self_row:
        pytest.skip("cannot find self in master users list")
    uid = self_row.get("id")
    d = requests.delete(f"{API}/master/users/{uid}", headers=_h(master_token))
    assert d.status_code in (400, 403), f"expected 400/403 for self-delete, got {d.status_code}"
