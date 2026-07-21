"""Backend tests for Maintyn new features: password reset, CSV imports, email notifications."""
import os
import re
import io
import time
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://community-manage-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"

BACKEND_LOG = "/var/log/supervisor/backend.err.log"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


def _tail_log(pattern: str, since_ts: float, timeout: float = 6.0):
    """Read backend log tail and return first match after since_ts."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            out = subprocess.check_output(["tail", "-n", "400", BACKEND_LOG], text=True, stderr=subprocess.STDOUT)
        except Exception:
            out = ""
        m = re.findall(pattern, out)
        if m:
            return m[-1]
        time.sleep(0.5)
    return None


# ---------------- Password reset ----------------

class TestPasswordReset:
    def test_forgot_password_existing_returns_ok_and_logs_link(self):
        t0 = time.time()
        r = requests.post(f"{API}/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        # Find token in log
        link = _tail_log(r"Password reset link for %s:.*token=([A-Za-z0-9_\-]+)" % re.escape(ADMIN_EMAIL), t0)
        assert link, "reset token not found in backend log"
        # Save token for next tests
        pytest.reset_token = link

    def test_forgot_password_unknown_still_ok(self):
        r = requests.post(f"{API}/auth/forgot-password", json={"email": "unknown_ghost_user@example.com"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_reset_password_invalid_token(self):
        r = requests.post(f"{API}/auth/reset-password", json={"token": "totally-bogus-token", "password": "NewPass@123"})
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "Invalid" in detail or "expired" in detail

    def test_reset_password_valid_then_login_then_restore(self):
        token = getattr(pytest, "reset_token", None)
        assert token, "prior forgot-password test must run first"
        new_pw = "NewPass@12345"
        r = requests.post(f"{API}/auth/reset-password", json={"token": token, "password": new_pw})
        assert r.status_code == 200, f"reset failed: {r.status_code} {r.text}"
        assert r.json() == {"ok": True}

        # login with new password
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": new_pw})
        assert r.status_code == 200

        # Reset back via same flow so subsequent tests keep working
        t0 = time.time()
        rr = requests.post(f"{API}/auth/forgot-password", json={"email": ADMIN_EMAIL})
        assert rr.status_code == 200
        tok2 = _tail_log(r"Password reset link for %s:.*token=([A-Za-z0-9_\-]+)" % re.escape(ADMIN_EMAIL), t0)
        assert tok2
        r2 = requests.post(f"{API}/auth/reset-password", json={"token": tok2, "password": ADMIN_PASS})
        assert r2.status_code == 200
        # sanity: login with original again
        r3 = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r3.status_code == 200


# ---------------- CSV imports ----------------

class TestCsvImport:
    def test_flats_import_csv(self, admin_headers):
        blk = f"TB{int(time.time())}"
        csv_content = (
            f"block,number,floor,bhk,occupancy\n"
            f"{blk},T101,1,2BHK,vacant\n"
            f"{blk},T102,1,3BHK,owner\n"
            f"{blk},T101,1,2BHK,vacant\n"  # duplicate -> skipped
            ",,,,\n"  # missing -> error
        )
        files = {"file": ("flats.csv", csv_content, "text/csv")}
        r = requests.post(f"{API}/flats/import-csv", files=files, headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 2, data
        assert data["skipped"] == 1, data
        assert any("missing" in e for e in data["errors"])
        # stash for next test
        pytest.test_block = blk

    def test_users_import_csv_and_link_flat(self, admin_headers):
        # Ensure a flat exists
        r = requests.get(f"{API}/flats", headers=admin_headers)
        assert r.status_code == 200
        flats = r.json()
        # Pick test block flat if created
        blk = getattr(pytest, "test_block", None)
        target = next((f for f in flats if blk and f.get("block") == blk and f.get("number") == "T101"), None)
        if not target:
            target = next((f for f in flats if f.get("block") == "TESTBLK" and f.get("number") == "T101"), None)
        assert target, "expected test flat to exist from previous test"

        uniq = int(time.time())
        blk = getattr(pytest, "test_block", "TESTBLK")
        csv_content = (
            "name,email,phone,role,password,block,flat_number\n"
            f"TEST User A,test_csv_{uniq}_a@maintyn.test,999,resident,welcome123,{blk},T101\n"
            f"TEST User B,test_csv_{uniq}_b@maintyn.test,999,resident,welcome123,,\n"
            f",bademail_{uniq}@maintyn.test,,resident,welcome123,,\n"  # missing name -> error
        )
        files = {"file": ("users.csv", csv_content, "text/csv")}
        r = requests.post(f"{API}/users/import-csv", files=files, headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["created"] == 2, data
        assert any("missing" in e for e in data["errors"])

        # Verify linkage
        r = requests.get(f"{API}/users", headers=admin_headers)
        users = r.json()
        a = next((u for u in users if u["email"] == f"test_csv_{uniq}_a@maintyn.test"), None)
        assert a is not None
        assert a.get("flat_id") == target["id"]


# ---------------- Invoice email notification ----------------

class TestNotifications:
    def test_invoice_created_triggers_email(self, admin_headers):
        # Find a flat with residents
        flats = requests.get(f"{API}/flats", headers=admin_headers).json()
        target = next((f for f in flats if f.get("residents")), None)
        if not target:
            pytest.skip("No flat with residents to test invoice email")
        resident_email = target["residents"][0]["email"]

        t0 = time.time()
        payload = {
            "flat_id": target["id"],
            "amount": 1234.0,
            "description": "TEST notify invoice",
            "month": "2026-02",
            "due_date": "2026-02-28",
        }
        r = requests.post(f"{API}/invoices", json=payload, headers=admin_headers)
        assert r.status_code == 200, r.text

        pattern = re.escape(f"Email sent to {resident_email}: New invoice")
        match = _tail_log(pattern, t0, timeout=15.0)
        assert match, f"Expected email log for {resident_email} not found"

        # Cleanup
        inv_id = r.json()["id"]
        requests.delete(f"{API}/invoices/{inv_id}", headers=admin_headers)

    def test_complaint_status_change_triggers_email(self, admin_headers):
        # Create a resident-owned complaint by using admin (created_by=admin)
        # Complaint email goes to created_by user
        c = requests.post(f"{API}/complaints",
                          json={"title": "TEST notify complaint", "description": "x", "category": "general"},
                          headers=admin_headers)
        assert c.status_code == 200, c.text
        cid = c.json()["id"]

        t0 = time.time()
        r = requests.patch(f"{API}/complaints/{cid}", json={"status": "in_progress"}, headers=admin_headers)
        assert r.status_code == 200, r.text
        pattern = re.escape(f"Email sent to {ADMIN_EMAIL}: Complaint update: TEST notify complaint")
        match = _tail_log(pattern, t0, timeout=15.0)
        assert match, "Expected complaint status email log not found"
