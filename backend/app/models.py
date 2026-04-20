"""SQLAlchemy ORM models."""

from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, JSON

from app.database import Base


class Device(Base):
    __tablename__ = "devices"

    device_id = Column(String, primary_key=True, index=True)
    readable_name = Column(String, unique=True, nullable=False, index=True)
    serial_id = Column(String, nullable=True)
    registered_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    calibration_status = Column(String, default="pending")  # pending | calibrated | needs_recalibration
    calibration_date = Column(DateTime, nullable=True)
    status = Column(String, default="active")  # active | inactive | maintenance | retired
    firmware_version = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    calibration = Column(JSON, nullable=True)
