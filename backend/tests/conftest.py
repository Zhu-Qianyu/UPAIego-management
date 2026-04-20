"""Shared test fixtures: in-memory DB, TestClient, mock board connector."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.main import app

SQLALCHEMY_TEST_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_TEST_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------- Fixtures ----------

MOCK_DETECT_RESULT = {
    "serial_id": "a1b2c3d4e5f60000",
}

MOCK_DETECT_RESULT_2 = {
    "serial_id": "ff00ee11dd220000",
}


@pytest.fixture(autouse=True)
def setup_database():
    """Create all tables before each test, drop them after."""
    Base.metadata.create_all(bind=engine)
    app.dependency_overrides[get_db] = override_get_db
    yield
    Base.metadata.drop_all(bind=engine)
    app.dependency_overrides.clear()


@pytest.fixture()
def client():
    """FastAPI TestClient wired to the in-memory DB."""
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def mock_board():
    """Patch board_connector.detect_device to return MOCK_DETECT_RESULT."""
    with patch("app.routes.devices.hw_detect_device") as mock_fn:
        mock_fn.return_value = MOCK_DETECT_RESULT.copy()
        yield mock_fn


@pytest.fixture()
def mock_board_provision():
    """Patch both detect_device and write_device_identity for provision tests."""
    with (
        patch("app.routes.devices.hw_detect_device") as mock_detect,
        patch("app.routes.devices.write_device_identity") as mock_write,
    ):
        mock_detect.return_value = MOCK_DETECT_RESULT.copy()
        mock_write.return_value = None
        yield mock_detect, mock_write


@pytest.fixture()
def db_session():
    """Yield a raw DB session for direct service-layer tests."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
