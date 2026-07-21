"""Backend tests for iteration 5: society settings, directory, committee, flats summary, complaint email."""
import os
import re
import time
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


def _tail_log(pattern: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            out = subprocess.check_output(["tail", "-n", "500", BACKEND_LOG], text=True, stderr=subprocess.STDOUT)
        except Exception:
            out = ""
        m = re.findall(pattern, out)
        if m:
            return m[-1]
        time.sleep(0.5)
    return None


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def resident_headers(admin_headers):
    """Register or reuse a resident user."""
    email = f"test_res_it5_{int(time.time()*1000)}_{os.getpid()}@example.com"
    r = requests.post(f"{API}/auth/register", json={
        "name": "TEST Resident IT5", "email": email, "password": "Test@1234", "phone": "9999900000"
    })
    assert r.status_code in (200, 201), r.text
    tok = r.json().get("access_token")
    if not tok:
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "Test@1234"})
        tok = r2.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}, email


# ---------------- Society ----------------

class TestSociety:
    def test_get_society_as_admin(self, admin_headers):
        r = requests.get(f"{API}/society", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("id") == "singleton"
        assert "name" in d
        assert "is_setup" in d

    def test_get_society_as_resident(self, resident_headers):
        hdrs, _ = resident_headers
        r = requests.get(f"{API}/society", headers=hdrs)
        assert r.status_code == 200

    def test_patch_society_forbidden_for_resident(self, resident_headers):
        hdrs, _ = resident_headers
        r = requests.patch(f"{API}/society", json={"name": "Hacker Society"}, headers=hdrs)
        assert r.status_code == 403, r.text

    def test_patch_society_admin_and_verify(self, admin_headers):
        # snapshot original
        orig = requests.get(f"{API}/society", headers=admin_headers).json()
        orig_name = orig.get("name") or "Maintyn Society"

        new_name = "Green Valley Residency"
        r = requests.patch(f"{API}/society", json={
            "name": new_name, "city": "Ahmedabad", "established_year": 2015,
            "contact_email": "office@gv.example.com", "contact_phone": "1234567890"
        }, headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == new_name
        assert d.get("is_setup") is True

        # GET verify persistence
        g = requests.get(f"{API}/society", headers=admin_headers).json()
        assert g["name"] == new_name
        assert g["city"] == "Ahmedabad"

        # Restore
        r2 = requests.patch(f"{API}/society", json={"name": orig_name}, headers=admin_headers)
        assert r2.status_code == 200
        assert requests.get(f"{API}/society", headers=admin_headers).json()["name"] == orig_name


# ---------------- Directory ----------------

class TestDirectory:
    def test_directory_admin(self, admin_headers):
        r = requests.get(f"{API}/directory", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert isinstance(d, list) and len(d) > 0
        u = d[0]
        for k in ("name", "role", "email"):
            assert k in u
        # no _id leaked
        assert "_id" not in u

    def test_directory_resident(self, resident_headers):
        hdrs, _ = resident_headers
        r = requests.get(f"{API}/directory", headers=hdrs)
        assert r.status_code == 200
        assert len(r.json()) > 0

    def test_committee_endpoint(self, admin_headers, resident_headers):
        r = requests.get(f"{API}/committee", headers=admin_headers)
        assert r.status_code == 200, r.text
        members = r.json()
        assert isinstance(members, list)
        # All results should be admin or committee role only
        for m in members:
            assert m["role"] in ("admin", "committee"), m
            assert "email" in m
        # Resident can also access
        rh, _ = resident_headers
        r2 = requests.get(f"{API}/committee", headers=rh)
        assert r2.status_code == 200


# ---------------- Flats summary ----------------

class TestFlatsSummary:
    def test_flats_summary_shape(self, admin_headers):
        r = requests.get(f"{API}/flats/summary", headers=admin_headers)
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("total", "occupied", "vacant", "owners", "tenants", "blocks"):
            assert k in d, f"missing {k} in {d}"
        assert isinstance(d["blocks"], list)
        if d["blocks"]:
            assert "block" in d["blocks"][0] and "count" in d["blocks"][0]
        # Sanity: occupied+vacant == total
        assert d["occupied"] + d["vacant"] == d["total"]

    def test_flats_summary_resident_accessible(self, resident_headers):
        hdrs, _ = resident_headers
        r = requests.get(f"{API}/flats/summary", headers=hdrs)
        assert r.status_code == 200


# ---------------- Complaint status change email ----------------

class TestComplaintEmail:
    def test_status_change_emails_creator(self, admin_headers):
        # Pick an existing complaint not created by admin (if any); else create one as admin
        r = requests.get(f"{API}/complaints", headers=admin_headers)
        assert r.status_code == 200
        complaints = r.json()

        # Get admin id
        me = requests.get(f"{API}/auth/me", headers=admin_headers).json()
        admin_id = me.get("id")

        target = next((c for c in complaints if c.get("created_by") and c["created_by"] != admin_id and c.get("status") != "resolved"), None)
        if target is None:
            # fallback: create one as admin
            c = requests.post(f"{API}/complaints",
                              json={"title": "TEST it5 notify", "description": "x", "category": "general"},
                              headers=admin_headers)
            assert c.status_code == 200, c.text
            target = c.json()

        cid = target["id"]
        # Toggle status to something new
        new_status = "in_progress" if target.get("status") != "in_progress" else "resolved"

        r = requests.patch(f"{API}/complaints/{cid}", json={"status": new_status}, headers=admin_headers)
        assert r.status_code == 200, r.text

        m = _tail_log(r"Email sent to [^:]+: Complaint update:", timeout=10.0)
        assert m, "Expected 'Complaint update' email log not found"
