"""Business logic for device management: name generation, registration, CRUD."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional, List, Tuple

from sqlalchemy import func, or_, cast, Integer
from sqlalchemy.orm import Session

from app.models import Device


def _next_readable_name(db: Session) -> str:
    """Generate the next readable name as a simple incrementing number ('1', '2', '3', ...).

    Finds the current max numeric readable_name and increments by 1.
    """
    all_names = db.query(Device.readable_name).all()
    max_num = 0
    for (name,) in all_names:
        try:
            num = int(name)
            if num > max_num:
                max_num = num
        except (ValueError, TypeError):
            continue
    return str(max_num + 1)


def generate_device_id_pair(db: Session) -> Tuple[str, str]:
    """Generate a new (device_id, readable_name) pair.

    device_id is a UUID4 string, readable_name is the next incrementing number.
    """
    device_id = str(uuid.uuid4())
    readable_name = _next_readable_name(db)
    return device_id, readable_name


def register_device(
    db: Session,
    device_id: str,
    readable_name: str,
    serial_id: Optional[str] = None,
) -> Device:
    """Register a new device in the database. Returns the created Device.

    Raises ValueError if device_id already exists.
    """
    existing = db.query(Device).filter(Device.device_id == device_id).first()
    if existing:
        raise ValueError(f"Device with id '{device_id}' is already registered")

    now = datetime.now(timezone.utc)

    device = Device(
        device_id=device_id,
        readable_name=readable_name,
        serial_id=serial_id,
        registered_at=now,
        last_seen=now,
        calibration_status="pending",
        status="active",
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def get_device(db: Session, device_id: str) -> Optional[Device]:
    """Fetch a single device by its ID."""
    return db.query(Device).filter(Device.device_id == device_id).first()


def list_devices(
    db: Session,
    offset: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    calibration_status: Optional[str] = None,
) -> Tuple[int, List[Device]]:
    """Return (total_count, devices) with optional filtering."""
    query = db.query(Device)
    if status:
        query = query.filter(Device.status == status)
    if calibration_status:
        query = query.filter(Device.calibration_status == calibration_status)

    total = query.count()
    devices = query.order_by(Device.registered_at.desc()).offset(offset).limit(limit).all()
    return total, devices


def update_device(db: Session, device_id: str, **kwargs) -> Optional[Device]:
    """Update writable fields on a device. Returns updated Device or None if not found."""
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if device is None:
        return None

    allowed_fields = {
        "calibration_status", "calibration_date", "status",
        "firmware_version", "notes", "calibration",
    }

    for key, value in kwargs.items():
        if key in allowed_fields and value is not None:
            setattr(device, key, value)

    device.last_seen = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)
    return device


def delete_device(db: Session, device_id: str) -> Optional[Device]:
    """Soft-delete a device by setting status to 'retired'."""
    device = db.query(Device).filter(Device.device_id == device_id).first()
    if device is None:
        return None

    device.status = "retired"
    device.last_seen = datetime.now(timezone.utc)
    db.commit()
    db.refresh(device)
    return device


def get_devices_by_ids(
    db: Session, device_ids: List[str]
) -> List[Device]:
    """Fetch devices whose device_id is in the given list."""
    if not device_ids:
        return []
    return db.query(Device).filter(Device.device_id.in_(device_ids)).all()


def get_devices_by_readable_names(
    db: Session, names: List[str]
) -> List[Device]:
    """Fetch devices whose readable_name is in the given list (exact match)."""
    if not names:
        return []
    return db.query(Device).filter(Device.readable_name.in_(names)).all()


def search_devices(
    db: Session, query_str: str, offset: int = 0, limit: int = 50
) -> Tuple[int, List[Device]]:
    """Full-text search across device_id, readable_name, serial_id, notes."""
    pattern = f"%{query_str}%"
    q = db.query(Device).filter(
        or_(
            Device.device_id.ilike(pattern),
            Device.readable_name.ilike(pattern),
            Device.serial_id.ilike(pattern),
            Device.notes.ilike(pattern),
        )
    )
    total = q.count()
    devices = q.order_by(Device.registered_at.desc()).offset(offset).limit(limit).all()
    return total, devices
