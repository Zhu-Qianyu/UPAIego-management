"""Full end-to-end workflow tests: detect, register, provision, list, update, QR, search, delete."""


def test_full_device_workflow(client, mock_board):
    """Walk through the entire device management lifecycle."""

    # 1. Detect device (mocked hardware)
    resp = client.post("/api/devices/detect", json={"port": "/dev/ttyUSB0"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["serial_id"] == "a1b2c3d4e5f60000"

    # 2. Register the detected device
    resp = client.post("/api/devices/register", json={
        "serial_id": data["serial_id"],
    })
    assert resp.status_code == 201
    device = resp.json()
    assert device["readable_name"] == "1"
    assert device["status"] == "active"
    assert device["calibration_status"] == "pending"
    assert device["serial_id"] == "a1b2c3d4e5f60000"
    device_id = device["device_id"]

    # 3. List devices — should contain exactly one
    resp = client.get("/api/devices")
    assert resp.status_code == 200
    listing = resp.json()
    assert listing["total"] == 1
    assert len(listing["devices"]) == 1
    assert listing["devices"][0]["device_id"] == device_id

    # 4. Get single device detail
    resp = client.get(f"/api/devices/{device_id}")
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["readable_name"] == "1"
    assert detail["serial_id"] == "a1b2c3d4e5f60000"

    # 5. Update calibration
    resp = client.put(f"/api/devices/{device_id}", json={
        "calibration_status": "calibrated",
        "notes": "Passed factory calibration",
    })
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["calibration_status"] == "calibrated"
    assert updated["notes"] == "Passed factory calibration"

    # 6. Generate QR code — should be a valid PNG
    resp = client.get(f"/api/devices/{device_id}/qr")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"

    # 7. Search by serial_id
    resp = client.get("/api/devices/search", params={"q": "a1b2c3"})
    assert resp.status_code == 200
    results = resp.json()
    assert results["total"] == 1
    assert results["devices"][0]["serial_id"] == "a1b2c3d4e5f60000"

    # 8. Register a second device — should get readable_name '2'
    resp = client.post("/api/devices/register", json={
        "serial_id": "ff00ee11dd220000",
    })
    assert resp.status_code == 201
    assert resp.json()["readable_name"] == "2"

    # 9. Generate device_id/readable_name pair
    resp = client.post("/api/devices/generate")
    assert resp.status_code == 200
    pair = resp.json()
    assert "device_id" in pair
    assert pair["readable_name"] == "3"

    # 10. Soft-delete the first device
    resp = client.delete(f"/api/devices/{device_id}")
    assert resp.status_code == 200
    deleted = resp.json()
    assert deleted["status"] == "retired"

    # Confirm device still exists in list (soft-deleted)
    resp = client.get("/api/devices")
    assert resp.json()["total"] == 2


def test_provision_workflow(client, mock_board_provision):
    """One-shot provision: detect + generate IDs + write to board + register."""
    mock_detect, mock_write = mock_board_provision

    resp = client.post("/api/devices/provision", json={
        "port": "/dev/ttyUSB0",
    })
    assert resp.status_code == 201
    device = resp.json()

    assert device["readable_name"] == "1"
    assert device["serial_id"] == "a1b2c3d4e5f60000"
    assert device["status"] == "active"
    assert len(device["device_id"]) == 36  # UUID

    # Verify detect was called
    mock_detect.assert_called_once()

    # Verify write_device_identity was called with correct args
    mock_write.assert_called_once()
    call_kwargs = mock_write.call_args
    assert call_kwargs.kwargs["device_id"] == device["device_id"]
    assert call_kwargs.kwargs["readable_name"] == "1"
    assert call_kwargs.kwargs["serial_id"] == "a1b2c3d4e5f60000"

    # Device should be in the database
    resp = client.get(f"/api/devices/{device['device_id']}")
    assert resp.status_code == 200
    assert resp.json()["serial_id"] == "a1b2c3d4e5f60000"


def test_provision_second_device_gets_name_2(client, mock_board_provision):
    """Provisioning a second device should get readable_name '2'."""
    mock_detect, mock_write = mock_board_provision

    resp = client.post("/api/devices/provision", json={"port": "/dev/ttyUSB0"})
    assert resp.status_code == 201
    assert resp.json()["readable_name"] == "1"

    resp = client.post("/api/devices/provision", json={"port": "/dev/ttyUSB0"})
    assert resp.status_code == 201
    assert resp.json()["readable_name"] == "2"
