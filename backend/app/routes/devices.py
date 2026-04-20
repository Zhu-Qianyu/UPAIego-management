"""Device API routes."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import (
    DetectRequest,
    DetectResponse,
    GenerateDeviceResponse,
    ProvisionRequest,
    RegisterRequest,
    DeviceUpdate,
    DeviceResponse,
    DeviceListResponse,
    PullCodeRequest,
    PullCodeResponse,
    DeployScriptsRequest,
    DeployScriptsResponse,
)
from app.services import device_service, qr_service
from app.services.board_connector import (
    detect_device as hw_detect_device,
    read_device_identity,
    write_device_identity,
    pull_code as hw_pull_code,
    run_deploy_scripts as hw_run_deploy_scripts,
)

router = APIRouter()


# ---------- Detection ----------

@router.post("/detect", response_model=DetectResponse)
def detect_device(req: DetectRequest):
    """Probe a connected board and return its serial_id (CPU serial)."""
    try:
        info = hw_detect_device(
            port=req.port,
            baud=req.baud,
            timeout=req.timeout,
            user=req.user,
            password=req.password,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return info


# ---------- Generate device_id / readable_name pair ----------

@router.post("/generate", response_model=GenerateDeviceResponse)
def generate_device_pair(db: Session = Depends(get_db)):
    """Generate a new (device_id, readable_name) pair without registering."""
    device_id, readable_name = device_service.generate_device_id_pair(db)
    return GenerateDeviceResponse(device_id=device_id, readable_name=readable_name)


# ---------- Registration ----------

@router.post("/register", response_model=DeviceResponse, status_code=201)
def register_device(req: RegisterRequest, db: Session = Depends(get_db)):
    """Register a new device.

    Provide serial_id directly, or provide port params to auto-detect.
    A new device_id (UUID) and readable_name are generated automatically.
    """
    serial_id = None

    if req.serial_id:
        serial_id = req.serial_id
    elif req.port:
        try:
            info = hw_detect_device(
                port=req.port,
                baud=req.baud,
                timeout=req.timeout,
                user=req.user,
                password=req.password,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        serial_id = info["serial_id"]
    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either 'serial_id' or 'port' for auto-detection.",
        )

    device_id, readable_name = device_service.generate_device_id_pair(db)

    try:
        device = device_service.register_device(
            db, device_id=device_id, readable_name=readable_name, serial_id=serial_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return device


# ---------- Provision (one-shot) ----------

@router.post("/provision", response_model=DeviceResponse, status_code=201)
def provision_device(req: ProvisionRequest, db: Session = Depends(get_db)):
    """One-shot provisioning: detect board, generate IDs, write to hardware, register.

    1. Connect to board via serial and read CPU serial (serial_id)
    2. Generate a new device_id (UUID) and readable_name
    3. Write identity JSON to board at /etc/UPAIego/device_id.json
    4. Register the device in the database
    """
    try:
        info = hw_detect_device(
            port=req.port, baud=req.baud, timeout=req.timeout,
            user=req.user, password=req.password,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Detection failed: {exc}")

    serial_id = info["serial_id"]

    try:
        existing = read_device_identity(
            port=req.port, baud=req.baud, timeout=req.timeout,
            user=req.user, password=req.password,
        )
    except RuntimeError:
        existing = None

    if existing and existing.get("device_id") and existing.get("readable_name"):
        device_id = existing["device_id"]
        readable_name = existing["readable_name"]
    else:
        device_id, readable_name = device_service.generate_device_id_pair(db)
        try:
            write_device_identity(
                port=req.port, baud=req.baud, timeout=req.timeout,
                user=req.user, password=req.password,
                device_id=device_id, readable_name=readable_name,
                serial_id=serial_id,
            )
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"Write to board failed: {exc}")

    try:
        device = device_service.register_device(
            db, device_id=device_id, readable_name=readable_name, serial_id=serial_id
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return device


# ---------- List ----------

@router.get("", response_model=DeviceListResponse)
def list_devices(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = None,
    calibration_status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    total, devices = device_service.list_devices(
        db, offset=offset, limit=limit, status=status, calibration_status=calibration_status
    )
    return DeviceListResponse(total=total, devices=devices)


# ---------- Search ----------

@router.get("/search", response_model=DeviceListResponse)
def search_devices(
    q: str = Query(..., min_length=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    total, devices = device_service.search_devices(db, q, offset=offset, limit=limit)
    return DeviceListResponse(total=total, devices=devices)


# ---------- Single device ----------

@router.get("/{device_id}", response_model=DeviceResponse)
def get_device(device_id: str, db: Session = Depends(get_db)):
    device = device_service.get_device(db, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


# ---------- Update ----------

@router.put("/{device_id}", response_model=DeviceResponse)
def update_device(device_id: str, body: DeviceUpdate, db: Session = Depends(get_db)):
    device = device_service.update_device(
        db,
        device_id,
        **body.model_dump(exclude_unset=True),
    )
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


# ---------- Delete (soft) ----------

@router.delete("/{device_id}", response_model=DeviceResponse)
def delete_device(device_id: str, db: Session = Depends(get_db)):
    device = device_service.delete_device(db, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


# ---------- QR Code ----------

@router.get("/{device_id}/qr")
def get_qr_code(device_id: str, db: Session = Depends(get_db)):
    """Generate and return a QR code PNG for the device."""
    device = device_service.get_device(db, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    png_bytes = qr_service.generate_qr_png(
        device_id=device.device_id,
        readable_name=device.readable_name,
    )
    return Response(content=png_bytes, media_type="image/png")


# ---------- Pull Code ----------

@router.post("/pull-code", response_model=PullCodeResponse)
def pull_code(req: PullCodeRequest):
    """Pull latest code and checkout a branch on the connected board."""
    try:
        result = hw_pull_code(
            port=req.port,
            baud=req.baud,
            timeout=req.timeout,
            user=req.user,
            password=req.password,
            branch=req.branch,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return result


# ---------- Deploy Scripts ----------

@router.post("/deploy", response_model=DeployScriptsResponse)
def deploy_scripts(req: DeployScriptsRequest):
    """Run build.sh and install.sh on the connected board."""
    try:
        result = hw_run_deploy_scripts(
            port=req.port,
            baud=req.baud,
            timeout=req.timeout,
            user=req.user,
            password=req.password,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return result
