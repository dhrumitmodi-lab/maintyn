"""Tests for society settings extensions (logo/UPI/bank) and file upload/download."""
import io
import os
import struct
import zlib
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://community-manage-3.preview.emergentagent.com').rstrip('/')
ADMIN = {"email": "admin@maintyn.app", "password": "Admin@12345"}
RESIDENT = {"email": "demo.resident@example.com", "password": "Resident@123"}


def _make_png_bytes():
    # Minimal 1x1 PNG
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = b'IHDR' + struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
    ihdr_chunk = struct.pack('>I', 13) + ihdr + struct.pack('>I', zlib.crc32(ihdr) & 0xffffffff)
    raw = b'\x00\xff\x00\x00'
    comp = zlib.compress(raw)
    idat = b'IDAT' + comp
    idat_chunk = struct.pack('>I', len(comp)) + idat + struct.pack('>I', zlib.crc32(idat) & 0xffffffff)
    iend = b'IEND'
    iend_chunk = struct.pack('>I', 0) + iend + struct.pack('>I', zlib.crc32(iend) & 0xffffffff)
    return sig + ihdr_chunk + idat_chunk + iend_chunk


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def resident_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json=RESIDENT)
    if r.status_code != 200:
        pytest.skip(f"resident login failed: {r.status_code} {r.text[:200]}")
    return r.json()["access_token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


class TestSocietyGet:
    def test_get_society_returns_new_fields(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/society", headers=_hdr(admin_token))
        assert r.status_code == 200
        data = r.json()
        for key in ["logo_file_id", "upi_id", "upi_qr_file_id",
                    "bank_name", "bank_account_holder",
                    "bank_account_number", "bank_ifsc"]:
            assert key in data, f"Missing key {key} in society response"


class TestSocietyPatchAuth:
    def test_resident_forbidden(self, resident_token):
        r = requests.patch(f"{BASE_URL}/api/society",
                           json={"name": "hacked"}, headers=_hdr(resident_token))
        assert r.status_code == 403


class TestSocietyPatchFields:
    def test_admin_can_patch_new_fields(self, admin_token):
        payload = {
            "name": "Green Valley Residency",
            "upi_id": "greenvalley@icici",
            "bank_name": "ICICI Bank",
            "bank_account_holder": "Green Valley Welfare Association",
            "bank_account_number": "012345678901",
            "bank_ifsc": "ICIC0001234",
        }
        r = requests.patch(f"{BASE_URL}/api/society", json=payload, headers=_hdr(admin_token))
        assert r.status_code == 200, r.text
        data = r.json()
        for k, v in payload.items():
            assert data[k] == v, f"{k} not persisted"

    def test_empty_string_clears_field(self, admin_token):
        # set then clear bank_ifsc
        requests.patch(f"{BASE_URL}/api/society",
                       json={"bank_ifsc": "TEST0001234"}, headers=_hdr(admin_token))
        r = requests.patch(f"{BASE_URL}/api/society",
                           json={"bank_ifsc": ""}, headers=_hdr(admin_token))
        assert r.status_code == 200
        assert r.json()["bank_ifsc"] is None
        # restore
        requests.patch(f"{BASE_URL}/api/society",
                       json={"bank_ifsc": "ICIC0001234"}, headers=_hdr(admin_token))


class TestFileUploadDownload:
    def test_upload_png_and_download(self, admin_token):
        png = _make_png_bytes()
        files = {"file": ("logo.png", png, "image/png")}
        r = requests.post(f"{BASE_URL}/api/files/upload",
                          files=files, headers=_hdr(admin_token))
        assert r.status_code == 200, r.text
        rec = r.json()
        assert "id" in rec and "storage_path" in rec
        fid = rec["id"]

        # Download with ?auth=
        d = requests.get(f"{BASE_URL}/api/files/{fid}/download",
                         params={"auth": admin_token})
        assert d.status_code == 200
        assert d.headers.get("content-type", "").startswith("image/")
        assert len(d.content) > 0

        # Store as society logo
        p = requests.patch(f"{BASE_URL}/api/society",
                           json={"logo_file_id": fid}, headers=_hdr(admin_token))
        assert p.status_code == 200
        assert p.json()["logo_file_id"] == fid

    def test_download_unauth(self):
        r = requests.get(f"{BASE_URL}/api/files/nonexistent/download")
        assert r.status_code == 401
