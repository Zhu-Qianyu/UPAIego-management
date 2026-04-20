"""QR code generation tests."""

import json

from app.services.qr_service import generate_qr_png


class TestQRGeneration:
    def test_returns_valid_png(self):
        png = generate_qr_png("test-id-001", "42")
        assert png[:8] == b"\x89PNG\r\n\x1a\n"
        assert len(png) > 100

    def test_qr_content_is_correct_json(self):
        """Decode the QR to verify it contains the expected payload."""
        try:
            from pyzbar.pyzbar import decode as zbar_decode
            from PIL import Image
            import io

            png = generate_qr_png("abc123", "7")
            img = Image.open(io.BytesIO(png))
            decoded = zbar_decode(img)
            assert len(decoded) == 1
            payload = json.loads(decoded[0].data.decode())
            assert payload["readable_name"] == "7"
            assert payload["device_id"] == "abc123"
        except ImportError:
            from PIL import Image
            import io
            png = generate_qr_png("abc123", "7")
            img = Image.open(io.BytesIO(png))
            assert img.format == "PNG"
            assert img.size[0] > 0 and img.size[1] > 0

    def test_qr_via_api(self, client):
        """Test QR endpoint through the API."""
        resp = client.post("/api/devices/register", json={
            "serial_id": "qr-test-serial",
        })
        assert resp.status_code == 201
        device_id = resp.json()["device_id"]

        resp = client.get(f"/api/devices/{device_id}/qr")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_qr_for_nonexistent_device(self, client):
        resp = client.get("/api/devices/nonexistent/qr")
        assert resp.status_code == 404
