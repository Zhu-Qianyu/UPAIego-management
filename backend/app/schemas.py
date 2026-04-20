"""Pydantic request / response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Optional, List, Any

from pydantic import BaseModel, Field


# ---------- Detection ----------

class DetectRequest(BaseModel):
    port: str = "/dev/ttyUSB0"
    baud: int = 1500000
    timeout: float = 5.0
    user: str = "cat"
    password: str = ""


class DetectResponse(BaseModel):
    serial_id: str


# ---------- Generate device_id / readable_name ----------

class GenerateDeviceResponse(BaseModel):
    device_id: str
    readable_name: str


# ---------- Registration ----------

class RegisterRequest(BaseModel):
    """Register a device. Supply *either* serial port params (to auto-detect)
    or provide serial_id directly."""
    # Option A: auto-detect via serial
    port: Optional[str] = None
    baud: int = 1500000
    timeout: float = 5.0
    user: str = "cat"
    password: str = ""
    # Option B: manual entry
    serial_id: Optional[str] = None


# ---------- Provision (one-shot) ----------

class ProvisionRequest(BaseModel):
    """One-shot provisioning: connect, detect, generate IDs, write to board, register."""
    port: str = "/dev/ttyUSB0"
    baud: int = 1500000
    timeout: float = 5.0
    user: str = "cat"
    password: str = ""


# ---------- Update ----------

class DeviceUpdate(BaseModel):
    calibration_status: Optional[str] = None
    calibration_date: Optional[datetime] = None
    status: Optional[str] = None
    firmware_version: Optional[str] = None
    notes: Optional[str] = None
    calibration: Optional[Any] = None


# ---------- Response ----------

class DeviceResponse(BaseModel):
    device_id: str
    readable_name: str
    serial_id: Optional[str] = None
    registered_at: Optional[datetime] = None
    last_seen: Optional[datetime] = None
    calibration_status: str = "pending"
    calibration_date: Optional[datetime] = None
    status: str = "active"
    firmware_version: Optional[str] = None
    notes: Optional[str] = None
    calibration: Optional[Any] = None

    model_config = {"from_attributes": True}


class DeviceListResponse(BaseModel):
    total: int
    devices: List[DeviceResponse]


# ---------- Pull Code ----------

class PullCodeRequest(BaseModel):
    port: str = "/dev/cu.usbserial-A5069RR4"
    baud: int = 1500000
    timeout: float = 30.0
    user: str = "cat"
    password: str = ""
    branch: str = "dev"


class PullCodeResponse(BaseModel):
    branch: str
    pull_output: str
    checkout_output: str


# ---------- Deploy Scripts ----------

class DeployScriptsRequest(BaseModel):
    port: str = "/dev/cu.usbserial-A5069RR4"
    baud: int = 1500000
    timeout: float = 120.0
    user: str = "cat"
    password: str = ""


class DeployScriptsResponse(BaseModel):
    scripts_dir: str
    results: dict[str, str]
