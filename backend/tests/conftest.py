import os

os.environ["DATABASE_URL"] = "postgresql+psycopg://parkvanta:parkvanta@localhost:55432/parkvanta_test"
os.environ["JWT_SECRET"] = "test-secret-key-that-is-long-enough-for-validation"
os.environ["ENVIRONMENT"] = "test"
os.environ["REDIS_URL"] = "redis://localhost:56379/15"
os.environ["LOGIN_RATE_LIMIT"] = "1000"

import psycopg
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

TEST_DB = "parkvanta_test"
ADMIN_DSN = "postgresql://parkvanta:parkvanta@localhost:55432/postgres"


def _ensure_test_database() -> None:
    with psycopg.connect(ADMIN_DSN, autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DB,)
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{TEST_DB}"')


_ensure_test_database()

from app.core.security import hash_password  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import SessionLocal, engine  # noqa: E402
import app.models  # noqa: E402,F401
from app.main import app as fastapi_app  # noqa: E402
from app.models import (  # noqa: E402
    Apartment,
    GuardProfile,
    Organization,
    ParkingSlot,
    ParkingZone,
    Property,
    ResidentProfile,
    Tower,
    User,
)
from app.models.enums import Role, VehicleCategory, ZoneCategory  # noqa: E402
from app.services import parking_service  # noqa: E402

PASSWORD = "TestPass123"


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture(autouse=True)
def clean_db():
    with SessionLocal() as db:
        tables = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
        db.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        db.commit()
    yield


@pytest.fixture
def client():
    with TestClient(fastapi_app) as test_client:
        yield test_client


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _make_user(db, *, organization_id, property_id, email, name, role, apartment_id=None):
    user = User(
        organization_id=organization_id,
        property_id=property_id,
        email=email,
        password_hash=hash_password(PASSWORD),
        full_name=name,
        role=role.value,
    )
    db.add(user)
    db.flush()
    if role == Role.RESIDENT:
        db.add(ResidentProfile(user_id=user.id, apartment_id=apartment_id, is_verified=True))
    if role == Role.SECURITY_GUARD:
        db.add(GuardProfile(user_id=user.id, property_id=property_id, badge_number="GRD-01"))
    return user


@pytest.fixture
def world(db_session):
    db = db_session

    org = Organization(name="Skyline Communities", slug="skyline")
    other_org = Organization(name="Rival Estates", slug="rival")
    db.add_all([org, other_org])
    db.flush()

    prop = Property(
        organization_id=org.id,
        name="Skyline Residency",
        address_line="12 Orchid Avenue",
        city="Bengaluru",
        state="Karnataka",
        pincode="560066",
    )
    other_prop = Property(organization_id=other_org.id, name="Rival Heights")
    db.add_all([prop, other_prop])
    db.flush()
    parking_service.ensure_policy(db, property_id=prop.id)
    parking_service.ensure_policy(db, property_id=other_prop.id)

    tower = Tower(property_id=prop.id, name="Tower A", floors=10)
    db.add(tower)
    db.flush()
    apartment = Apartment(property_id=prop.id, tower_id=tower.id, number="A-101", floor=1)
    other_apartment = Apartment(property_id=prop.id, tower_id=tower.id, number="A-102", floor=1)
    db.add_all([apartment, other_apartment])
    db.flush()

    visitor_zone = ParkingZone(
        property_id=prop.id, name="Visitor Bay", category=ZoneCategory.VISITOR.value, priority=10
    )
    service_zone = ParkingZone(
        property_id=prop.id, name="Service Bay", category=ZoneCategory.SERVICE.value, priority=20
    )
    reserved_zone = ParkingZone(
        property_id=prop.id, name="Reserved Bay", category=ZoneCategory.RESERVED.value, priority=30
    )
    db.add_all([visitor_zone, service_zone, reserved_zone])
    db.flush()

    slot = ParkingSlot(
        property_id=prop.id,
        zone_id=visitor_zone.id,
        code="V-01",
        category=ZoneCategory.VISITOR.value,
        vehicle_category=VehicleCategory.FOUR_WHEELER.value,
    )
    bike_slot = ParkingSlot(
        property_id=prop.id,
        zone_id=visitor_zone.id,
        code="V-2W-01",
        category=ZoneCategory.VISITOR.value,
        vehicle_category=VehicleCategory.TWO_WHEELER.value,
    )
    service_slot = ParkingSlot(
        property_id=prop.id,
        zone_id=service_zone.id,
        code="S-01",
        category=ZoneCategory.SERVICE.value,
        vehicle_category="ANY",
    )
    reserved_slot = ParkingSlot(
        property_id=prop.id,
        zone_id=reserved_zone.id,
        code="R-01",
        category=ZoneCategory.RESERVED.value,
        vehicle_category=VehicleCategory.FOUR_WHEELER.value,
    )
    db.add_all([slot, bike_slot, service_slot, reserved_slot])
    db.flush()

    admin = _make_user(
        db, organization_id=org.id, property_id=prop.id, email="admin@skyline.dev",
        name="Ananya Rao", role=Role.SOCIETY_ADMIN,
    )
    guard = _make_user(
        db, organization_id=org.id, property_id=prop.id, email="guard@skyline.dev",
        name="Suresh Kumar", role=Role.SECURITY_GUARD,
    )
    resident = _make_user(
        db, organization_id=org.id, property_id=prop.id, email="resident@skyline.dev",
        name="Arghya Bose", role=Role.RESIDENT, apartment_id=apartment.id,
    )
    neighbour = _make_user(
        db, organization_id=org.id, property_id=prop.id, email="neighbour@skyline.dev",
        name="Meera Iyer", role=Role.RESIDENT, apartment_id=other_apartment.id,
    )
    other_admin = _make_user(
        db, organization_id=other_org.id, property_id=other_prop.id, email="admin@rival.dev",
        name="Rival Admin", role=Role.SOCIETY_ADMIN,
    )
    db.commit()

    return {
        "org_id": org.id,
        "property_id": prop.id,
        "other_org_id": other_org.id,
        "other_property_id": other_prop.id,
        "apartment_id": apartment.id,
        "slot_id": slot.id,
        "service_slot_id": service_slot.id,
        "reserved_slot_id": reserved_slot.id,
        "admin_email": admin.email,
        "guard_email": guard.email,
        "resident_email": resident.email,
        "neighbour_email": neighbour.email,
        "other_admin_email": other_admin.email,
        "guard_id": guard.id,
    }


def login(client: TestClient, email: str, password: str = PASSWORD) -> dict:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def tokens(client, world):
    return {
        "resident": login(client, world["resident_email"])["access_token"],
        "guard": login(client, world["guard_email"])["access_token"],
        "admin": login(client, world["admin_email"])["access_token"],
        "neighbour": login(client, world["neighbour_email"])["access_token"],
        "other_admin": login(client, world["other_admin_email"])["access_token"],
    }
