"""Regression tests for iteration 7 aggregation-based refactor.

Covers:
- GET /api/stats (admin + resident) — aggregation pipelines for totals
- GET /api/users — batch _flat_map population
- POST /api/admin/digest/preview — aggregation on invoices + expenses
- GET /api/directory + /api/committee — flat_label population
- GET /api/flats — residents batch population
- GET /api/invoices, /api/utility-bills, /api/visitors — flat population
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://community-manage-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"
RESIDENT_EMAIL = "demo.resident@example.com"
RESIDENT_PASS = "Resident@123"


def _login(email, password):
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_h():
    return {"Authorization": f"Bearer {_login(ADMIN_EMAIL, ADMIN_PASS)}"}


@pytest.fixture(scope="session")
def resident_h():
    return {"Authorization": f"Bearer {_login(RESIDENT_EMAIL, RESIDENT_PASS)}"}


# ------------- /api/stats (admin) -------------
class TestStatsAdmin:
    def test_stats_shape_and_totals(self, admin_h):
        r = requests.get(f"{API}/stats", headers=admin_h)
        assert r.status_code == 200, r.text
        d = r.json()
        # Required keys
        for k in [
            "total_flats", "total_users", "total_residents",
            "invoices_unpaid", "invoices_paid",
            "total_collected", "total_pending", "total_expenses",
            "complaints_open", "complaints_inprogress", "complaints_resolved",
            "active_visitors", "announcements_count",
            "bookings_today", "bookings_upcoming", "amenities_active",
        ]:
            assert k in d, f"missing key {k}"
        # Types
        assert isinstance(d["total_collected"], (int, float))
        assert isinstance(d["total_pending"], (int, float))
        assert isinstance(d["total_expenses"], (int, float))
        assert d["total_collected"] >= 0
        assert d["total_pending"] >= 0
        assert d["total_expenses"] >= 0
        # Sanity: counts >= 0
        for k in ["invoices_paid", "invoices_unpaid", "bookings_today", "bookings_upcoming",
                  "active_visitors", "complaints_open", "complaints_resolved"]:
            assert d[k] >= 0

    def test_stats_totals_match_invoice_and_expense_data(self, admin_h):
        """Cross-check aggregation totals against raw invoice + expense listings."""
        stats = requests.get(f"{API}/stats", headers=admin_h).json()
        invs = requests.get(f"{API}/invoices", headers=admin_h).json()
        exps = requests.get(f"{API}/expenses", headers=admin_h).json()

        paid_sum = sum(float(i["amount"]) for i in invs if i.get("status") == "paid")
        pending_sum = sum(float(i["amount"]) for i in invs if i.get("status") != "paid")
        exp_sum = sum(float(e["amount"]) for e in exps)
        paid_count = sum(1 for i in invs if i.get("status") == "paid")
        unpaid_count = sum(1 for i in invs if i.get("status") != "paid")

        assert abs(stats["total_collected"] - paid_sum) < 0.01, (
            f"total_collected {stats['total_collected']} != sum(paid) {paid_sum}")
        assert abs(stats["total_pending"] - pending_sum) < 0.01, (
            f"total_pending {stats['total_pending']} != sum(unpaid) {pending_sum}")
        assert abs(stats["total_expenses"] - exp_sum) < 0.01, (
            f"total_expenses {stats['total_expenses']} != sum(expenses) {exp_sum}")
        assert stats["invoices_paid"] == paid_count
        assert stats["invoices_unpaid"] == unpaid_count


# ------------- /api/stats (resident) -------------
class TestStatsResident:
    def test_resident_stats_has_my_fields(self, resident_h, admin_h):
        r = requests.get(f"{API}/stats", headers=resident_h)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "my_upcoming_bookings" in d
        # resident has flat_id per seed
        assert "my_unpaid_count" in d
        assert "my_pending_amount" in d
        assert d["my_pending_amount"] >= 0
        assert d["my_unpaid_count"] >= 0

        # cross-verify against invoices
        me = requests.get(f"{API}/auth/me", headers=resident_h).json()
        flat_id = me.get("flat_id")
        assert flat_id, "resident should have a flat_id"
        invs = requests.get(f"{API}/invoices", headers=resident_h).json()
        expected_unpaid = [i for i in invs if i.get("flat_id") == flat_id and i.get("status") != "paid"]
        assert d["my_unpaid_count"] == len(expected_unpaid)
        expected_amt = sum(float(i["amount"]) for i in expected_unpaid)
        assert abs(d["my_pending_amount"] - expected_amt) < 0.01, (
            f"my_pending_amount {d['my_pending_amount']} != expected {expected_amt}")


# ------------- /api/users batch flat population -------------
class TestUsersFlatPopulation:
    def test_users_have_flat_object_populated(self, admin_h):
        r = requests.get(f"{API}/users", headers=admin_h)
        assert r.status_code == 200, r.text
        users = r.json()
        assert isinstance(users, list) and len(users) > 0
        with_flat = [u for u in users if u.get("flat_id")]
        assert with_flat, "expected at least one user with a flat_id in seed"
        for u in with_flat:
            assert u.get("flat") is not None, f"user {u.get('email')} has flat_id but no 'flat' populated"
            f = u["flat"]
            assert "block" in f and "number" in f, f"flat object missing keys: {f}"
            # ensure no mongo _id leak
            assert "_id" not in f


# ------------- /api/admin/digest/preview -------------
class TestDigestPreview:
    def test_digest_preview_payload(self, admin_h):
        r = requests.post(f"{API}/admin/digest/preview", headers=admin_h)
        assert r.status_code == 200, r.text
        result = r.json()
        # send_monthly_digest returns a dict; find the payload
        # It could be {'sent': [...], 'payload': {...}} or the payload inline; check keys.
        # Look for the digest keys either at top or nested
        candidates = [result]
        if isinstance(result, dict):
            for v in result.values():
                if isinstance(v, dict):
                    candidates.append(v)
        payload = None
        for c in candidates:
            if isinstance(c, dict) and "invoices_paid" in c and "expenses_total" in c:
                payload = c
                break
        assert payload is not None, f"digest payload not found in response: {result}"
        for k in ["total_invoices", "invoices_paid", "invoices_unpaid",
                  "collected", "pending", "expenses_total", "resolved_complaints"]:
            assert k in payload, f"digest payload missing {k}: {payload}"
        assert payload["total_invoices"] == payload["invoices_paid"] + payload["invoices_unpaid"]
        assert payload["collected"] >= 0
        assert payload["pending"] >= 0
        assert payload["expenses_total"] >= 0


# ------------- /api/directory + /api/committee -------------
class TestDirectoryCommittee:
    def test_directory_has_flat_label(self, admin_h):
        r = requests.get(f"{API}/directory", headers=admin_h)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list) and len(docs) > 0
        # At least one user has flat_label populated
        # (we can't guarantee all have flat_id but seeded resident does)
        with_label = [d for d in docs if d.get("flat_label")]
        assert with_label, "no directory entry has flat_label populated"

    def test_committee_endpoint_ok(self, admin_h):
        r = requests.get(f"{API}/committee", headers=admin_h)
        assert r.status_code == 200
        docs = r.json()
        assert isinstance(docs, list)
        # Admin must appear
        assert any(u.get("role") == "admin" for u in docs)


# ------------- /api/flats residents batch -------------
class TestFlatsResidents:
    def test_flats_have_residents_array(self, admin_h):
        r = requests.get(f"{API}/flats", headers=admin_h)
        assert r.status_code == 200
        flats = r.json()
        assert isinstance(flats, list) and len(flats) > 0
        for f in flats:
            assert "residents" in f, f"flat {f.get('id')} missing residents array"
            assert isinstance(f["residents"], list)
        # At least one flat should have residents
        assert any(f["residents"] for f in flats), "no flat has any residents"


# ------------- invoices / utility-bills / visitors -------------
class TestListEndpointsFlatPopulation:
    def test_invoices_flat_populated(self, admin_h):
        r = requests.get(f"{API}/invoices", headers=admin_h)
        assert r.status_code == 200
        invs = r.json()
        if not invs:
            pytest.skip("no invoices seeded")
        for i in invs:
            if i.get("flat_id"):
                assert i.get("flat") is not None, f"invoice {i.get('id')} missing flat"
                assert "_id" not in i.get("flat", {})

    def test_utility_bills_flat_populated(self, admin_h):
        r = requests.get(f"{API}/utility-bills", headers=admin_h)
        assert r.status_code == 200
        bills = r.json()
        if not bills:
            pytest.skip("no utility bills seeded")
        for b in bills:
            if b.get("flat_id"):
                assert b.get("flat") is not None
                assert "_id" not in b.get("flat", {})

    def test_visitors_flat_populated(self, admin_h):
        r = requests.get(f"{API}/visitors", headers=admin_h)
        assert r.status_code == 200
        vs = r.json()
        if not vs:
            pytest.skip("no visitors seeded")
        for v in vs:
            if v.get("flat_id"):
                assert v.get("flat") is not None
                assert "_id" not in v.get("flat", {})
