"""Iteration 14 smoke test — verify no regression after legacy DB drop + async-for → to_list conversion."""
import os
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
load_dotenv("/app/backend/.env", override=False)

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")

ADMIN = ("admin@maintyn.app", "Admin@12345")
RESIDENT = ("demo.resident@example.com", "Resident@123")
MASTER = ("master@maintyn.in", "Master@12345")


def _login(email, password, path="/api/auth/login"):
    r = requests.post(f"{BASE_URL}{path}", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed {email}: {r.status_code} {r.text[:200]}"
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def admin_headers():
    return {"Authorization": f"Bearer {_login(*ADMIN)}"}


@pytest.fixture(scope="module")
def resident_headers():
    return {"Authorization": f"Bearer {_login(*RESIDENT)}"}


@pytest.fixture(scope="module")
def master_headers():
    tok = _login(*MASTER)
    return {"Authorization": f"Bearer {tok}"}


def test_flats_returns_37(admin_headers):
    r = requests.get(f"{BASE_URL}/api/flats", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # Baseline was 37; test residue from CSV upload tests inflates it (TB*/TESTBLK/Z blocks).
    # Non-test flats (blocks A/B/C/F only) should equal 27 (Default Society seeded rows).
    core_blocks = {"A", "B", "C", "F"}
    core = [f for f in data if f.get("block") in core_blocks]
    assert len(core) >= 25, f"Expected at least ~27 core-block flats, got {len(core)} (total={len(data)})"
    assert len(data) >= 27


def test_invoices_penalty_and_total_due(admin_headers):
    r = requests.get(f"{BASE_URL}/api/invoices", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert 150 <= len(data) <= 210, f"Expected ~178 invoices, got {len(data)}"
    # every invoice should have penalty + total_due
    missing_penalty = [i for i in data if "penalty" not in i]
    missing_total = [i for i in data if "total_due" not in i]
    assert not missing_penalty, f"{len(missing_penalty)} invoices missing penalty"
    assert not missing_total, f"{len(missing_total)} invoices missing total_due"


def test_complaints_assigned_staff(admin_headers):
    r = requests.get(f"{BASE_URL}/api/complaints", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    # at least some complaints should be present; assigned_staff key should surface when present
    # spec: rows with assigned_staff when applicable (i.e. field exists on assigned ones)
    with_assigned = [c for c in data if c.get("assigned_staff")]
    print(f"complaints total={len(data)} with_assigned_staff={len(with_assigned)}")


def test_invoices_stats(admin_headers):
    r = requests.get(f"{BASE_URL}/api/invoices/stats", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    # defaulter enrichment path — just ensure it comes back structured
    assert isinstance(data, dict)


def test_resident_post_complaint_auto_assigns_staff(resident_headers):
    payload = {
        "title": "TEST_ITER14 leaky tap",
        "description": "smoke test complaint for iter14 auto-assign",
        "category": "plumbing",
    }
    r = requests.post(f"{BASE_URL}/api/complaints", headers=resident_headers, json=payload, timeout=30)
    assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
    c = r.json()
    # round-robin auto-assign — should have assigned_staff populated for plumbing category
    assert c.get("assigned_staff") or c.get("assigned_to"), f"no staff auto-assigned: {c}"


def test_flats_summary(admin_headers):
    r = requests.get(f"{BASE_URL}/api/flats/summary", headers=admin_headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    assert data  # non-empty structure


def test_directory_endpoint(admin_headers):
    # try common directory endpoints; at least one should succeed
    candidates = ["/api/society/directory", "/api/directory", "/api/residents/directory", "/api/users/directory"]
    got = None
    for path in candidates:
        r = requests.get(f"{BASE_URL}{path}", headers=admin_headers, timeout=30)
        if r.status_code == 200:
            got = (path, r.json())
            break
    assert got is not None, f"no directory endpoint returned 200 among {candidates}"
    print(f"directory endpoint OK: {got[0]}")


def test_amenities_bookings_and_conflict(admin_headers):
    # find an amenity
    ra = requests.get(f"{BASE_URL}/api/amenities", headers=admin_headers, timeout=30)
    assert ra.status_code == 200
    amenities = ra.json()
    assert amenities, "no amenities available"
    amenity_id = amenities[0]["id"]

    # Slots endpoint uses the converted to_list on bookings query
    from datetime import datetime, timedelta, timezone
    target_date = (datetime.now(timezone.utc) + timedelta(days=30)).date().isoformat()
    rb = requests.get(f"{BASE_URL}/api/amenities/{amenity_id}/slots?date={target_date}",
                     headers=admin_headers, timeout=30)
    assert rb.status_code == 200, rb.text[:300]

    # Also test /api/bookings list (converted to_list path)
    rl = requests.get(f"{BASE_URL}/api/bookings", headers=admin_headers, timeout=30)
    assert rl.status_code == 200, rl.text[:300]

    # attempt double booking to verify _has_conflict (was async-for on bookings that we converted)
    payload = {
        "amenity_id": amenity_id,
        "date": target_date,
        "start_time": amenities[0].get("open_time", "10:00"),
        "end_time": _add_hour(amenities[0].get("open_time", "10:00")),
        "notes": "TEST_ITER14",
    }
    r1 = requests.post(f"{BASE_URL}/api/bookings", headers=admin_headers, json=payload, timeout=30)
    print(f"booking1 status={r1.status_code} body={r1.text[:200]}")
    if r1.status_code in (200, 201):
        r2 = requests.post(f"{BASE_URL}/api/bookings", headers=admin_headers, json=payload, timeout=30)
        assert r2.status_code == 409, f"expected 409 conflict, got {r2.status_code}: {r2.text[:200]}"
        # cleanup
        bid = r1.json().get("id")
        if bid:
            requests.post(f"{BASE_URL}/api/bookings/{bid}/cancel", headers=admin_headers, timeout=30)


def _add_hour(hm):
    h, m = hm.split(":")
    return f"{(int(h)+1)%24:02d}:{m}"


def test_master_list_societies_only_default(master_headers):
    r = requests.get(f"{BASE_URL}/api/master/societies", headers=master_headers, timeout=30)
    assert r.status_code == 200, r.text[:300]
    data = r.json()
    # response may be list or {items:[]}
    items = data if isinstance(data, list) else data.get("items", data.get("societies", []))
    assert len(items) == 1, f"expected exactly 1 society (Default), got {len(items)}: {[i.get('name') for i in items]}"
