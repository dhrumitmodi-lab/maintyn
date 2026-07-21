"""Backend tests for Monthly Community Digest feature."""
import os
import re
import time
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://community-manage-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    return r


@pytest.fixture(scope="module")
def admin_headers():
    r = _login(ADMIN_EMAIL, ADMIN_PASS)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="module")
def resident_headers():
    # Register a fresh resident (self-signup defaults to resident role)
    uniq = int(time.time())
    email = f"test_res_digest_{uniq}@example.com"
    pw = "Passw0rd!"
    r = requests.post(f"{API}/auth/register", json={"name": "TEST Res Digest", "email": email, "password": pw})
    if r.status_code not in (200, 201):
        pytest.skip(f"could not register resident: {r.status_code} {r.text}")
    tok = r.json().get("access_token")
    if not tok:
        # try login
        r2 = _login(email, pw)
        tok = r2.json().get("access_token")
    return {"Authorization": f"Bearer {tok}"}


def _tail_log(pattern: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            out = subprocess.check_output(["tail", "-n", "800", BACKEND_LOG], text=True, stderr=subprocess.STDOUT)
        except Exception:
            out = ""
        m = re.findall(pattern, out)
        if m:
            return m[-1]
        time.sleep(0.4)
    return None


# ---------- Preview ----------

class TestDigestPreview:
    def test_preview_admin_ok(self, admin_headers):
        r = requests.post(f"{API}/admin/digest/preview", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        required = ["label", "month_start", "month_end", "collection_pct", "invoices_paid",
                    "invoices_unpaid", "total_invoices", "collected", "pending",
                    "expenses_total", "resolved_complaints", "open_complaints",
                    "upcoming_bookings", "notices"]
        for k in required:
            assert k in data, f"missing key {k} in preview: {data.keys()}"
        # label format like "June 2026"
        assert re.match(r"^[A-Z][a-z]+ \d{4}$", data["label"]), data["label"]
        # month_start is YYYY-MM-01
        assert re.match(r"^\d{4}-\d{2}-01$", data["month_start"])
        assert isinstance(data["upcoming_bookings"], list)
        assert isinstance(data["notices"], list)
        assert data["skipped"] is False or data.get("skipped") is False

    def test_preview_forbidden_for_resident(self, resident_headers):
        r = requests.post(f"{API}/admin/digest/preview", headers=resident_headers)
        assert r.status_code == 403, r.text

    def test_preview_forbidden_no_auth(self):
        r = requests.post(f"{API}/admin/digest/preview")
        # 401 (no cookie or bearer) is expected
        assert r.status_code in (401, 403), r.status_code


# ---------- Send / Idempotency ----------

class TestDigestSend:
    def test_send_admin(self, admin_headers):
        r = requests.post(f"{API}/admin/digest/send", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "skipped" in data and "month" in data
        # Either a fresh send or already-sent idempotent skip is valid.
        assert re.match(r"^\d{4}-\d{2}$", data["month"])
        if data["skipped"] is False:
            assert "sent_count" in data
            assert data["sent_count"] >= 1
            assert data["total_users"] >= data["sent_count"]
            # verify at least one email log line
            month_label = data.get("label")
            # e.g., "Email sent to admin@maintyn.app: maintyn · <Month> digest"
            pattern = r"Email sent to [^:]+: maintyn · %s digest" % re.escape(month_label)
            match = _tail_log(pattern, timeout=10.0)
            assert match, f"expected send-log line matching {pattern!r} not found"
        # Save for next test
        pytest.digest_month = data["month"]

    def test_send_idempotent_second_call(self, admin_headers):
        r = requests.post(f"{API}/admin/digest/send", headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["skipped"] is True, f"expected skipped=True, got {data}"
        assert re.match(r"^\d{4}-\d{2}$", data["month"])
        # payload fields still present alongside skipped
        for k in ("label", "collection_pct", "upcoming_bookings", "notices"):
            assert k in data

    def test_send_forbidden_for_resident(self, resident_headers):
        r = requests.post(f"{API}/admin/digest/send", headers=resident_headers)
        assert r.status_code == 403


# ---------- Runs ----------

class TestDigestRuns:
    def test_runs_admin(self, admin_headers):
        r = requests.get(f"{API}/admin/digest/runs", headers=admin_headers)
        assert r.status_code == 200, r.text
        runs = r.json()
        assert isinstance(runs, list)
        # After send test, at least one entry should be present.
        assert len(runs) >= 1, "expected at least one digest run"
        first = runs[0]
        for k in ("month", "label", "sent_at", "sent_count", "total_users"):
            assert k in first, f"missing {k} in run {first}"
        # sorted desc by sent_at
        if len(runs) > 1:
            assert runs[0]["sent_at"] >= runs[1]["sent_at"]
        # no MongoDB _id leaked
        assert "_id" not in first

    def test_runs_forbidden_for_resident(self, resident_headers):
        r = requests.get(f"{API}/admin/digest/runs", headers=resident_headers)
        assert r.status_code == 403


# ---------- Scheduler ----------

class TestScheduler:
    def test_scheduler_started_log(self):
        try:
            out = subprocess.check_output(["grep", "-h", "Monthly digest scheduler started", BACKEND_LOG], text=True)
        except subprocess.CalledProcessError:
            out = ""
        assert "Monthly digest scheduler started (cron: day=1 hour=9)" in out, \
            "APScheduler startup log line not found"
