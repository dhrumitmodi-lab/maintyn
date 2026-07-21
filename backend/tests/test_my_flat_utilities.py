"""Tests for My Flat + Utility Connections + Utility Bills (iteration 6)."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                    break
    except Exception:
        pass

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"
RESIDENT_EMAIL = "demo.resident@example.com"
RESIDENT_PASS = "Resident@123"


def _login(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    tok = r.json().get("access_token")
    assert tok
    return tok


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def resident_token():
    return _login(RESIDENT_EMAIL, RESIDENT_PASS)


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---- /api/my-flat ----
class TestMyFlat:
    def test_resident_my_flat(self, resident_token):
        r = requests.get(f"{BASE_URL}/api/my-flat", headers=H(resident_token))
        assert r.status_code == 200, r.text
        data = r.json()
        assert "flat" in data
        assert "residents" in data
        assert "connections" in data
        assert "recent_bills" in data
        assert data["flat"] is not None, "Demo resident should have a flat"
        assert isinstance(data["connections"], list)

    def test_admin_my_flat_no_flat(self, admin_token):
        # admin may or may not have a flat_id; endpoint must not error
        r = requests.get(f"{BASE_URL}/api/my-flat", headers=H(admin_token))
        assert r.status_code == 200
        d = r.json()
        assert set(["flat", "residents", "connections", "recent_bills"]).issubset(d.keys())

    def test_my_flat_unauth(self):
        r = requests.get(f"{BASE_URL}/api/my-flat")
        assert r.status_code in (401, 403)


# ---- utility connections ----
class TestUtilityConnections:
    @pytest.fixture(scope="class")
    def resident_flat_id(self, resident_token):
        r = requests.get(f"{BASE_URL}/api/my-flat", headers=H(resident_token))
        return r.json()["flat"]["id"]

    def test_list_own_flat(self, resident_token, resident_flat_id):
        r = requests.get(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", headers=H(resident_token))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_resident_cannot_access_other_flat(self, admin_token, resident_token, resident_flat_id):
        # find some other flat
        r = requests.get(f"{BASE_URL}/api/flats", headers=H(admin_token))
        assert r.status_code == 200
        other = next((f for f in r.json() if f["id"] != resident_flat_id), None)
        if not other:
            pytest.skip("no other flat available")
        r2 = requests.get(f"{BASE_URL}/api/flats/{other['id']}/utility-connections", headers=H(resident_token))
        assert r2.status_code == 403

    def test_admin_can_access_any_flat(self, admin_token, resident_flat_id):
        r = requests.get(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", headers=H(admin_token))
        assert r.status_code == 200

    def test_create_invalid_utility_type(self, resident_token, resident_flat_id):
        payload = {"utility_type": "gas_stove", "provider_name": "X", "customer_id": "1"}
        r = requests.post(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", json=payload, headers=H(resident_token))
        assert r.status_code == 400

    def test_create_patch_delete_connection(self, resident_token, resident_flat_id):
        payload = {"utility_type": "water", "provider_name": "TEST_BWSSB", "customer_id": "TEST_W123", "meter_number": "TESTMTR"}
        r = requests.post(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", json=payload, headers=H(resident_token))
        assert r.status_code in (200, 201), r.text
        conn = r.json()
        assert conn["utility_type"] == "water"
        assert conn["provider_name"] == "TEST_BWSSB"
        assert conn["customer_id"] == "TEST_W123"
        cid = conn["id"]

        # verify listing includes it
        r2 = requests.get(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", headers=H(resident_token))
        assert any(c["id"] == cid for c in r2.json())

        # PATCH
        upd = {"utility_type": "water", "provider_name": "TEST_BWSSB_v2", "customer_id": "TEST_W123"}
        r3 = requests.patch(f"{BASE_URL}/api/utility-connections/{cid}", json=upd, headers=H(resident_token))
        assert r3.status_code == 200
        assert r3.json()["provider_name"] == "TEST_BWSSB_v2"

        # DELETE
        r4 = requests.delete(f"{BASE_URL}/api/utility-connections/{cid}", headers=H(resident_token))
        assert r4.status_code in (200, 204)

        # verify gone
        r5 = requests.get(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", headers=H(resident_token))
        assert not any(c["id"] == cid for c in r5.json())


# ---- utility bills ----
class TestUtilityBills:
    @pytest.fixture(scope="class")
    def resident_flat_id(self, resident_token):
        return requests.get(f"{BASE_URL}/api/my-flat", headers=H(resident_token)).json()["flat"]["id"]

    def test_resident_list_scoped(self, resident_token, resident_flat_id):
        r = requests.get(f"{BASE_URL}/api/utility-bills", headers=H(resident_token))
        assert r.status_code == 200
        for b in r.json():
            assert b["flat_id"] == resident_flat_id

    def test_admin_can_filter(self, admin_token, resident_flat_id):
        r = requests.get(f"{BASE_URL}/api/utility-bills?flat_id={resident_flat_id}", headers=H(admin_token))
        assert r.status_code == 200
        for b in r.json():
            assert b["flat_id"] == resident_flat_id

    def test_create_pay_delete_bill_with_connection_inherit(self, resident_token, resident_flat_id):
        # create connection
        conn_payload = {"utility_type": "electricity", "provider_name": "TEST_BESCOM", "customer_id": "TEST_EL999"}
        rc = requests.post(f"{BASE_URL}/api/flats/{resident_flat_id}/utility-connections", json=conn_payload, headers=H(resident_token))
        assert rc.status_code in (200, 201)
        cid = rc.json()["id"]

        # create bill omitting provider/customer -> should inherit
        bill_payload = {
            "utility_type": "electricity",
            "connection_id": cid,
            "amount": 1234.5,
            "bill_period": "2026-01",
            "due_date": "2026-02-10",
        }
        rb = requests.post(f"{BASE_URL}/api/utility-bills", json=bill_payload, headers=H(resident_token))
        assert rb.status_code in (200, 201), rb.text
        bill = rb.json()
        assert bill["provider_name"] == "TEST_BESCOM"
        assert bill["customer_id"] == "TEST_EL999"
        assert bill["flat_id"] == resident_flat_id
        assert bill.get("status") in ("unpaid", "pending", None) or bill.get("paid") in (False, None)
        bid = bill["id"]

        # pay
        rp = requests.post(f"{BASE_URL}/api/utility-bills/{bid}/pay", json={"method": "upi", "note": "TEST"}, headers=H(resident_token))
        assert rp.status_code == 200
        paid = rp.json()
        assert paid.get("status") == "paid" or paid.get("paid") is True

        # verify via GET list
        rl = requests.get(f"{BASE_URL}/api/utility-bills", headers=H(resident_token))
        found = next((b for b in rl.json() if b["id"] == bid), None)
        assert found is not None
        assert found.get("status") == "paid" or found.get("paid") is True

        # delete bill and connection (cleanup)
        rd = requests.delete(f"{BASE_URL}/api/utility-bills/{bid}", headers=H(resident_token))
        assert rd.status_code in (200, 204)
        requests.delete(f"{BASE_URL}/api/utility-connections/{cid}", headers=H(resident_token))

    def test_invalid_utility_type_bill(self, resident_token, resident_flat_id):
        payload = {"utility_type": "cooking_gas", "amount": 100, "bill_period": "2026-01", "due_date": "2026-02-10"}
        r = requests.post(f"{BASE_URL}/api/utility-bills", json=payload, headers=H(resident_token))
        assert r.status_code == 400
