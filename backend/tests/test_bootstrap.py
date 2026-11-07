import pytest
from sqlalchemy import select

from app.bootstrap import BootstrapError, bootstrap
from app.models import Organization, Property, SocietyPolicy, User
from app.models.enums import Role


def test_bootstrap_creates_society_admin_and_policy(client, db_session):
    org, prop, admin = bootstrap(
        db_session,
        org_name="Bootstrap Society",
        org_slug="bootstrap-society",
        property_name="Bootstrap Residency",
        admin_name="First Admin",
        admin_email="first.admin@example.com",
        admin_password="Bootstrap123",
        city="Bengaluru",
    )

    assert admin.role == Role.SOCIETY_ADMIN.value
    assert admin.property_id == prop.id
    assert prop.join_code and len(prop.join_code) == 16
    assert db_session.scalar(
        select(SocietyPolicy).where(SocietyPolicy.property_id == prop.id)
    ) is not None

    response = client.post(
        "/api/v1/auth/login",
        json={"email": "first.admin@example.com", "password": "Bootstrap123"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["user"]["role"] == "SOCIETY_ADMIN"


def test_bootstrap_refuses_duplicate_slug_or_account(db_session):
    bootstrap(
        db_session,
        org_name="One Society",
        org_slug="one-society",
        property_name="One Residency",
        admin_name="First Admin",
        admin_email="one.admin@example.com",
        admin_password="Bootstrap123",
    )

    with pytest.raises(BootstrapError, match="slug"):
        bootstrap(
            db_session,
            org_name="Another Society",
            org_slug="one-society",
            property_name="Another Residency",
            admin_name="Other Admin",
            admin_email="other.admin@example.com",
            admin_password="Bootstrap123",
        )

    with pytest.raises(BootstrapError, match="account"):
        bootstrap(
            db_session,
            org_name="Third Society",
            org_slug="third-society",
            property_name="Third Residency",
            admin_name="Third Admin",
            admin_email="one.admin@example.com",
            admin_password="Bootstrap123",
        )

    assert db_session.scalar(select(Organization).where(Organization.slug == "one-society"))
    assert db_session.scalar(select(Property).where(Property.name == "One Residency"))
    assert db_session.scalar(select(User).where(User.email == "one.admin@example.com"))
