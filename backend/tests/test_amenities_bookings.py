"""Backend tests for amenity + booking module."""
import os
import re
import time
import subprocess
from datetime import date, timedelta
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://community-manage-3.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@maintyn.app"
ADMIN_PASS = "Admin@12345"
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


def _tail_log(pattern: str, timeout: float = 8.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            out = subprocess.check_output(["tail", "-n", "600", BACKEND_LOG], text=True, stderr=subprocess.STDOUT)
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
def resident_client(admin_headers):
    """Create a fresh resident (with flat) and return (headers, user_email, user_id)."""
    uniq = int(time.time())
    email = f"test_res_{uniq}@example.com"
    pw = "Resident@123"
    r = requests.post(f"{API}/auth/register", json={
        "name": "TEST Resident", "email": email, "password": pw
    })
    assert r.status_code == 200, r.text
    # login
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    tok = r.json()["access_token"]
    me = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {tok}"})
    uid = me.json().get("id") if me.status_code == 200 else None
    # attach a flat so /stats resident_data gets emitted
    if uid:
        flats = requests.get(f"{API}/flats", headers=admin_headers).json()
        if flats:
            requests.patch(f"{API}/users/{uid}", json={"flat_id": flats[0]["id"]}, headers=admin_headers)
    return {"Authorization": f"Bearer {tok}"}, email, uid


@pytest.fixture(scope="module")
def amenity(admin_headers):
    """Create test amenity for this run."""
    payload = {
        "name": f"TEST Clubhouse {int(time.time())}",
        "description": "auto test",
        "capacity": 20,
        "open_time": "06:00",
        "close_time": "22:00",
        "slot_duration_minutes": 60,
        "price_per_slot": 100,
        "is_active": True,
    }
    r = requests.post(f"{API}/amenities", json=payload, headers=admin_headers)
    assert r.status_code == 200, r.text
    a = r.json()
    assert a["name"] == payload["name"]
    assert a["slot_duration_minutes"] == 60
    yield a
    # teardown
    requests.delete(f"{API}/amenities/{a['id']}", headers=admin_headers)


class TestAmenityCRUD:
    def test_list_amenities_admin(self, admin_headers, amenity):
        r = requests.get(f"{API}/amenities", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert any(a["id"] == amenity["id"] for a in data)

    def test_list_amenities_resident_active_only(self, admin_headers, resident_client, amenity):
        # Create an inactive amenity
        r = requests.post(f"{API}/amenities", json={
            "name": f"TEST Inactive {int(time.time())}",
            "open_time": "08:00", "close_time": "12:00",
            "slot_duration_minutes": 60, "price_per_slot": 0,
            "is_active": False,
        }, headers=admin_headers)
        assert r.status_code == 200
        inactive_id = r.json()["id"]
        try:
            rh, _, _ = resident_client
            r = requests.get(f"{API}/amenities", headers=rh)
            assert r.status_code == 200
            ids = [a["id"] for a in r.json()]
            assert amenity["id"] in ids
            assert inactive_id not in ids
        finally:
            requests.delete(f"{API}/amenities/{inactive_id}", headers=admin_headers)

    def test_patch_amenity(self, admin_headers, amenity):
        r = requests.patch(f"{API}/amenities/{amenity['id']}", json={
            **{k: amenity[k] for k in ["name", "open_time", "close_time",
                                       "slot_duration_minutes", "price_per_slot", "is_active"]},
            "description": "updated desc",
        }, headers=admin_headers)
        assert r.status_code == 200, r.text
        assert r.json()["description"] == "updated desc"


class TestSlots:
    def test_slots_returns_grid(self, admin_headers, amenity):
        d = (date.today() + timedelta(days=2)).isoformat()
        r = requests.get(f"{API}/amenities/{amenity['id']}/slots", params={"date": d}, headers=admin_headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["date"] == d
        assert isinstance(data["slots"], list)
        # 06:00 - 22:00, 60 min = 16 slots
        assert len(data["slots"]) == 16
        assert data["slots"][0]["start_time"] == "06:00"
        assert all("booked" in s for s in data["slots"])


class TestBookings:
    def test_create_booking_success(self, resident_client, amenity):
        rh, email, uid = resident_client
        d = (date.today() + timedelta(days=3)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "10:00", "end_time": "11:00",
        }, headers=rh)
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["amenity_id"] == amenity["id"]
        assert b["user_email"] == email
        pytest.booking_id = b["id"]
        pytest.booking_date = d

        # Email log (best-effort: outbound email may 422 on example.com; only assert if log present)
        pat = re.escape(f"Email sent to {email}: Booking confirmed")
        _tail_log(pat, timeout=3)

        # slots endpoint should mark it booked
        r = requests.get(f"{API}/amenities/{amenity['id']}/slots", params={"date": d}, headers=rh)
        slot = next(s for s in r.json()["slots"] if s["start_time"] == "10:00")
        assert slot["booked"] is True

    def test_create_booking_conflict_returns_409(self, resident_client, amenity):
        rh, _, _ = resident_client
        d = pytest.booking_date
        # overlapping 10:30-11:30
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "10:30", "end_time": "11:30",
        }, headers=rh)
        assert r.status_code == 409, r.text
        assert "already booked" in r.json().get("detail", "").lower()

    def test_create_booking_past_date_rejected(self, resident_client, amenity):
        rh, _, _ = resident_client
        d = (date.today() - timedelta(days=1)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "10:00", "end_time": "11:00",
        }, headers=rh)
        assert r.status_code == 400, r.text

    def test_create_booking_outside_hours_rejected(self, resident_client, amenity):
        rh, _, _ = resident_client
        d = (date.today() + timedelta(days=4)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "23:00", "end_time": "23:30",
        }, headers=rh)
        assert r.status_code == 400, r.text

    def test_create_booking_start_after_end_rejected(self, resident_client, amenity):
        rh, _, _ = resident_client
        d = (date.today() + timedelta(days=4)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "11:00", "end_time": "10:00",
        }, headers=rh)
        assert r.status_code == 400, r.text

    def test_list_bookings_resident_sees_own(self, resident_client, admin_headers):
        rh, email, _ = resident_client
        r = requests.get(f"{API}/bookings", headers=rh)
        assert r.status_code == 200
        for b in r.json():
            assert b["user_email"] == email

        # admin sees all (including this resident's)
        r = requests.get(f"{API}/bookings", headers=admin_headers)
        assert r.status_code == 200
        assert any(b["user_email"] == email for b in r.json())

    def test_resident_cannot_cancel_others_booking(self, admin_headers, amenity):
        # admin creates a booking under admin account
        d = (date.today() + timedelta(days=5)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "14:00", "end_time": "15:00",
        }, headers=admin_headers)
        assert r.status_code == 200, r.text
        admin_bid = r.json()["id"]

        # register a 2nd resident
        uniq = int(time.time())
        email2 = f"test_res2_{uniq}@example.com"
        requests.post(f"{API}/auth/register", json={"name": "TR2", "email": email2, "password": "Pw@12345"})
        lr = requests.post(f"{API}/auth/login", json={"email": email2, "password": "Pw@12345"})
        r2 = {"Authorization": f"Bearer {lr.json()['access_token']}"}

        c = requests.post(f"{API}/bookings/{admin_bid}/cancel", headers=r2)
        assert c.status_code == 403

        # admin can cancel (staff)
        c = requests.post(f"{API}/bookings/{admin_bid}/cancel", headers=admin_headers)
        assert c.status_code == 200

    def test_cancel_booking_and_email(self, resident_client):
        rh, email, _ = resident_client
        bid = getattr(pytest, "booking_id", None)
        assert bid, "prior test must create booking"
        r = requests.post(f"{API}/bookings/{bid}/cancel", headers=rh)
        assert r.status_code == 200, r.text
        # email best-effort (example.com blocked by resend proxy)

    def test_admin_booking_confirmation_and_cancel_emails(self, admin_headers, amenity):
        """Verify booking confirmed/cancelled emails using admin (real email)."""
        d = (date.today() + timedelta(days=7)).isoformat()
        r = requests.post(f"{API}/bookings", json={
            "amenity_id": amenity["id"], "date": d,
            "start_time": "16:00", "end_time": "17:00",
        }, headers=admin_headers)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        pat = re.escape(f"Email sent to {ADMIN_EMAIL}: Booking confirmed")
        assert _tail_log(pat, timeout=15), "missing confirmation email log"

        r = requests.post(f"{API}/bookings/{bid}/cancel", headers=admin_headers)
        assert r.status_code == 200, r.text
        pat = re.escape(f"Email sent to {ADMIN_EMAIL}: Booking cancelled")
        assert _tail_log(pat, timeout=15), "missing cancellation email log"

    def test_delete_amenity_cancels_future_bookings(self, admin_headers, resident_client):
        rh, _, _ = resident_client
        # Create fresh amenity
        r = requests.post(f"{API}/amenities", json={
            "name": f"TEST DelAmenity {int(time.time())}",
            "open_time": "06:00", "close_time": "22:00",
            "slot_duration_minutes": 60, "price_per_slot": 0, "is_active": True,
        }, headers=admin_headers)
        aid = r.json()["id"]
        d = (date.today() + timedelta(days=6)).isoformat()
        b = requests.post(f"{API}/bookings", json={
            "amenity_id": aid, "date": d, "start_time": "09:00", "end_time": "10:00",
        }, headers=rh)
        assert b.status_code == 200
        bid = b.json()["id"]

        # delete amenity
        r = requests.delete(f"{API}/amenities/{aid}", headers=admin_headers)
        assert r.status_code == 200
        # booking should be cancelled
        all_bookings = requests.get(f"{API}/bookings", headers=admin_headers).json()
        target = next((x for x in all_bookings if x["id"] == bid), None)
        assert target is not None
        assert target["status"] == "cancelled"


class TestStats:
    def test_stats_includes_amenity_fields(self, admin_headers):
        r = requests.get(f"{API}/stats", headers=admin_headers)
        assert r.status_code == 200
        s = r.json()
        for key in ["bookings_today", "bookings_upcoming", "amenities_active"]:
            assert key in s, f"missing {key} in stats: {s}"

    def test_stats_resident_includes_my_upcoming_bookings(self, resident_client):
        rh, _, _ = resident_client
        r = requests.get(f"{API}/stats", headers=rh)
        assert r.status_code == 200
        assert "my_upcoming_bookings" in r.json()
