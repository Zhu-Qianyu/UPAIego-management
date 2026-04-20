"""CRUD edge-case tests."""


def _register(client, serial_id="test-serial"):
    """Register a device via the API. Returns the response."""
    return client.post("/api/devices/register", json={
        "serial_id": serial_id,
    })


class TestRegisterEdgeCases:
    def test_missing_serial_id_and_port_returns_400(self, client):
        resp = client.post("/api/devices/register", json={})
        assert resp.status_code == 400


class TestGetDevice:
    def test_nonexistent_device_returns_404(self, client):
        resp = client.get("/api/devices/nonexistent-id")
        assert resp.status_code == 404

    def test_get_existing_device(self, client):
        resp = _register(client, serial_id="my-serial")
        assert resp.status_code == 201
        device_id = resp.json()["device_id"]

        resp = client.get(f"/api/devices/{device_id}")
        assert resp.status_code == 200
        assert resp.json()["serial_id"] == "my-serial"


class TestUpdateDevice:
    def test_update_nonexistent_returns_404(self, client):
        resp = client.put("/api/devices/nonexistent", json={"status": "inactive"})
        assert resp.status_code == 404

    def test_update_fields(self, client):
        resp = _register(client)
        device_id = resp.json()["device_id"]

        resp = client.put(f"/api/devices/{device_id}", json={
            "status": "maintenance",
            "firmware_version": "v2.1.0",
            "notes": "Under repair",
        })
        assert resp.status_code == 200
        d = resp.json()
        assert d["status"] == "maintenance"
        assert d["firmware_version"] == "v2.1.0"
        assert d["notes"] == "Under repair"


class TestListDevices:
    def test_pagination(self, client):
        for i in range(5):
            _register(client, serial_id=f"serial-{i:03d}")

        resp = client.get("/api/devices", params={"offset": 2, "limit": 2})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["devices"]) == 2

    def test_filter_by_status(self, client):
        r1 = _register(client, serial_id="active-serial")
        r2 = _register(client, serial_id="maint-serial")
        maint_id = r2.json()["device_id"]

        client.put(f"/api/devices/{maint_id}", json={"status": "maintenance"})

        resp = client.get("/api/devices", params={"status": "maintenance"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["devices"][0]["device_id"] == maint_id

    def test_filter_by_calibration(self, client):
        _register(client, serial_id="cal-1")
        r2 = _register(client, serial_id="cal-2")
        cal_id = r2.json()["device_id"]

        client.put(f"/api/devices/{cal_id}", json={"calibration_status": "calibrated"})

        resp = client.get("/api/devices", params={"calibration_status": "calibrated"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1


class TestDeleteDevice:
    def test_delete_nonexistent_returns_404(self, client):
        resp = client.delete("/api/devices/nonexistent")
        assert resp.status_code == 404

    def test_soft_delete(self, client):
        resp = _register(client)
        device_id = resp.json()["device_id"]

        resp = client.delete(f"/api/devices/{device_id}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "retired"

        resp = client.get(f"/api/devices/{device_id}")
        assert resp.status_code == 200
        assert resp.json()["status"] == "retired"


class TestSearch:
    def test_search_by_serial_id(self, client):
        _register(client, serial_id="alpha-serial-001")
        _register(client, serial_id="beta-serial-002")

        resp = client.get("/api/devices/search", params={"q": "alpha"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1

    def test_search_by_readable_name(self, client):
        _register(client, serial_id="test-serial")
        resp = client.get("/api/devices/search", params={"q": "1"})
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

    def test_search_no_results(self, client):
        resp = client.get("/api/devices/search", params={"q": "nonexistent"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 0
