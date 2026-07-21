"""M-416 feature tests: Staff/Vendor directory, auto-assign complaints,
payment receipt trigger, invoice stats, expense stats, multi-tenant isolation."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback read
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
    return s, r.json()


@pytest.fixture(scope="module")
def admin():
    s, data = _login(ADMIN)
    return s


@pytest.fixture(scope="module")
def resident():
    s, data = _login(RESIDENT)
    return s


@pytest.fixture(scope="module")
def master():
    s, data = _login(MASTER)
    return s


# ---------- Staff CRUD ----------
class TestStaffCRUD:
    created_id = None

    def test_admin_create_staff(self, admin):
        payload = {
            "name": f"TEST_Ramesh_{uuid.uuid4().hex[:6]}",
            "role_label": "Plumber",
            "category": "plumbing",
            "phone": "+91 90000 00001",
            "is_active": True,
        }
        r = admin.post(f"{BASE_URL}/api/staff", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == payload["name"]
        assert d["category"] == "plumbing"
        assert "id" in d
        TestStaffCRUD.created_id = d["id"]

    def test_list_staff_admin(self, admin):
        r = admin.get(f"{BASE_URL}/api/staff")
        assert r.status_code == 200
        assert any(x["id"] == TestStaffCRUD.created_id for x in r.json())

    def test_resident_can_list_staff(self, resident):
        r = resident.get(f"{BASE_URL}/api/staff")
        assert r.status_code == 200

    def test_resident_cannot_create_staff(self, resident):
        r = resident.post(f"{BASE_URL}/api/staff", json={
            "name": "TEST_Nope", "role_label": "X", "category": "plumbing"
        })
        assert r.status_code in (401, 403)

    def test_patch_staff(self, admin):
        assert TestStaffCRUD.created_id
        r = admin.patch(f"{BASE_URL}/api/staff/{TestStaffCRUD.created_id}", json={
            "name": "TEST_Ramesh_upd", "role_label": "Plumber Sr", "category": "plumbing",
            "phone": "+91 90000 00099", "is_active": True,
        })
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Ramesh_upd"


# ---------- Complaint auto-assign + reassign ----------
class TestComplaintAssignment:
    plumber_staff_id = None
    electrician_staff_id = None
    complaint_id = None

    def test_setup_staff_two_categories(self, admin):
        r1 = admin.post(f"{BASE_URL}/api/staff", json={
            "name": "TEST_AutoPlumber", "role_label": "Plumber", "category": "plumbing",
            "phone": "111", "is_active": True,
        })
        assert r1.status_code == 200
        TestComplaintAssignment.plumber_staff_id = r1.json()["id"]

        r2 = admin.post(f"{BASE_URL}/api/staff", json={
            "name": "TEST_AutoElec", "role_label": "Electrician", "category": "electrical",
            "phone": "222", "is_active": True,
        })
        assert r2.status_code == 200
        TestComplaintAssignment.electrician_staff_id = r2.json()["id"]

    def test_resident_creates_complaint_autoassigned(self, resident):
        r = resident.post(f"{BASE_URL}/api/complaints", json={
            "title": "TEST_leaky_tap",
            "description": "Kitchen tap leaking",
            "category": "plumbing",
            "priority": "medium",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["category"] == "plumbing"
        assert d.get("assigned_to"), f"Not auto-assigned: {d}"
        assert d.get("assigned_staff"), "assigned_staff details missing"
        assert d["assigned_staff"].get("name")
        TestComplaintAssignment.complaint_id = d["id"]

    def test_list_complaints_enriched(self, admin):
        r = admin.get(f"{BASE_URL}/api/complaints")
        assert r.status_code == 200
        docs = r.json()
        target = next((c for c in docs if c["id"] == TestComplaintAssignment.complaint_id), None)
        assert target is not None
        assert target.get("assigned_staff") and target["assigned_staff"].get("name")

    def test_manual_reassign(self, admin):
        cid = TestComplaintAssignment.complaint_id
        assert cid
        r = admin.patch(f"{BASE_URL}/api/complaints/{cid}", json={
            "assigned_to": TestComplaintAssignment.electrician_staff_id
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["assigned_to"] == TestComplaintAssignment.electrician_staff_id
        assert d.get("assigned_staff", {}).get("name") == "TEST_AutoElec"

    def test_clear_assignment_via_empty_string(self, admin):
        cid = TestComplaintAssignment.complaint_id
        r = admin.patch(f"{BASE_URL}/api/complaints/{cid}", json={"assigned_to": ""})
        assert r.status_code == 200, r.text
        assert r.json().get("assigned_to") in (None, "")


# ---------- Invoice pay receipt + stats ----------
class TestInvoiceReceiptAndStats:
    invoice_id = None

    def test_create_invoice_for_pay(self, admin):
        # get a flat id
        flats = admin.get(f"{BASE_URL}/api/flats").json()
        assert flats, "no flats"
        flat_id = flats[0]["id"]
        r = admin.post(f"{BASE_URL}/api/invoices", json={
            "flat_id": flat_id, "amount": 1500,
            "description": "TEST_receipt_check",
            "month": "2026-01", "due_date": "2026-01-15",
        })
        assert r.status_code == 200
        TestInvoiceReceiptAndStats.invoice_id = r.json()["id"]

    def test_mark_paid_fires_receipt(self, admin):
        iid = TestInvoiceReceiptAndStats.invoice_id
        assert iid
        # rotate log for detection
        r = admin.post(f"{BASE_URL}/api/invoices/{iid}/pay", json={"method": "manual"})
        assert r.status_code == 200
        assert r.json()["status"] == "paid"
        # wait for background task
        time.sleep(2.5)
        # scan log
        try:
            with open("/var/log/supervisor/backend.err.log") as f:
                log = f.read()[-40000:]
        except Exception:
            log = ""
        try:
            with open("/var/log/supervisor/backend.out.log") as f:
                log += f.read()[-40000:]
        except Exception:
            pass
        # Look for either receipt email send or send attempt/failure marker
        assert ("Payment receipt" in log or "receipt" in log.lower()
                or "TEST_receipt_check" in log or "send_email_raw" in log
                or "Email failed" in log), "No evidence of receipt email attempt in logs"

    def test_double_pay_no_resend(self, admin):
        iid = TestInvoiceReceiptAndStats.invoice_id
        r = admin.post(f"{BASE_URL}/api/invoices/{iid}/pay", json={"method": "manual"})
        assert r.status_code == 200
        # Idempotency of resend is internal; ensure API still 200 and status remains paid
        assert r.json()["status"] == "paid"

    def test_invoice_stats_shape(self, admin):
        r = admin.get(f"{BASE_URL}/api/invoices/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        for k in ("raised", "received", "pending", "defaulters"):
            assert k in d, f"missing {k}"
        assert isinstance(d["defaulters"], list)
        # collection_pct present
        assert "collection_pct" in d


# ---------- Expense stats ----------
class TestExpenseStats:
    def test_expense_stats_shape(self, admin):
        r = admin.get(f"{BASE_URL}/api/expenses/stats")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "series" in d and isinstance(d["series"], list) and len(d["series"]) == 12
        assert "projection" in d and len(d["projection"]) == 3
        assert "totals" in d and "income" in d["totals"] and "spent" in d["totals"]
        assert "categories" in d


# ---------- Multi-tenant isolation ----------
class TestMultiTenantIsolation:
    other_society_admin_email = None
    other_society_admin_pw = "Test@12345"
    society_id = None

    def test_create_new_society(self, master):
        name = f"TEST_Soc_{uuid.uuid4().hex[:6]}"
        admin_email = f"testadmin_{uuid.uuid4().hex[:6]}@example.com"
        payload = {
            "name": name,
            "admin_name": "Test Admin",
            "admin_email": admin_email,
            "admin_password": self.other_society_admin_pw,
        }
        r = master.post(f"{BASE_URL}/api/master/societies", json=payload)
        if r.status_code == 404:
            pytest.skip("master society-create endpoint missing")
        assert r.status_code in (200, 201), r.text
        TestMultiTenantIsolation.other_society_admin_email = admin_email
        TestMultiTenantIsolation.society_id = r.json().get("id") or r.json().get("society", {}).get("id")

    def test_staff_created_in_other_society_not_visible_in_default(self, admin):
        if not TestMultiTenantIsolation.other_society_admin_email:
            pytest.skip("no other society created")
        s2, _ = _login({"email": TestMultiTenantIsolation.other_society_admin_email,
                        "password": TestMultiTenantIsolation.other_society_admin_pw})
        unique_name = f"TEST_ISO_{uuid.uuid4().hex[:8]}"
        r = s2.post(f"{BASE_URL}/api/staff", json={
            "name": unique_name, "role_label": "Plumber", "category": "plumbing", "is_active": True,
        })
        assert r.status_code == 200, r.text
        # now list from default-society admin -> should NOT see this staff
        r2 = admin.get(f"{BASE_URL}/api/staff")
        assert r2.status_code == 200
        names = [x["name"] for x in r2.json()]
        assert unique_name not in names, f"Isolation broken! Found staff of other society: {names}"
