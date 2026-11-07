"""First-run provisioning for a single ParkVanta property.

Creates the organization, property, default policy and first society
administrator. It is intentionally single-use: it refuses to overwrite an
existing organization slug or account.

    python -m app.bootstrap \
      --org-name "Skyline Communities" --org-slug skyline \
      --property-name "Skyline Residency" \
      --admin-name "Ananya Rao" --admin-email admin@example.com

The password is read from BOOTSTRAP_ADMIN_PASSWORD or --password. Prefer the
environment variable so the secret does not enter shell history.
"""

from __future__ import annotations

import argparse
import os
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.database.session import session_scope
from app.models import Organization, Property, User
from app.models.enums import Role
from app.services import audit_service, parking_service


class BootstrapError(RuntimeError):
    """A safe, operator-facing bootstrap failure."""


def _validate_password(value: str) -> None:
    if len(value) < 8:
        raise BootstrapError("Admin password must be at least 8 characters long")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise BootstrapError("Admin password must contain both letters and digits")


def bootstrap(
    db: Session,
    *,
    org_name: str,
    org_slug: str,
    property_name: str,
    admin_name: str,
    admin_email: str,
    admin_password: str,
    address_line: str = "",
    city: str = "",
    state: str = "",
    pincode: str = "",
    timezone: str = "Asia/Kolkata",
) -> tuple[Organization, Property, User]:
    """Provision one society and its first administrator in a single transaction."""
    org_slug = org_slug.strip().lower()
    admin_email = admin_email.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", org_slug):
        raise BootstrapError("Organization slug must contain lowercase letters, digits or hyphens")
    _validate_password(admin_password)

    if db.scalar(select(Organization.id).where(Organization.slug == org_slug)) is not None:
        raise BootstrapError(f"Organization slug '{org_slug}' already exists")
    if db.scalar(select(User.id).where(User.email == admin_email)) is not None:
        raise BootstrapError(f"An account already exists for {admin_email}")

    org = Organization(name=org_name.strip(), slug=org_slug)
    db.add(org)
    db.flush()

    prop = Property(
        organization_id=org.id,
        name=property_name.strip(),
        address_line=address_line.strip(),
        city=city.strip(),
        state=state.strip(),
        pincode=pincode.strip(),
        timezone=timezone.strip() or "Asia/Kolkata",
    )
    db.add(prop)
    db.flush()
    parking_service.ensure_policy(db, property_id=prop.id)

    admin = User(
        organization_id=org.id,
        property_id=prop.id,
        email=admin_email,
        password_hash=hash_password(admin_password),
        full_name=admin_name.strip(),
        role=Role.SOCIETY_ADMIN.value,
        is_active=True,
    )
    db.add(admin)
    db.flush()
    audit_service.record(
        db,
        action="platform.bootstrap",
        entity_type="organization",
        organization_id=org.id,
        actor_user_id=admin.id,
        entity_id=org.id,
        details={"property_id": str(prop.id), "admin_email": admin.email},
    )
    db.commit()
    db.refresh(org)
    db.refresh(prop)
    db.refresh(admin)
    return org, prop, admin


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="python -m app.bootstrap")
    parser.add_argument("--org-name", default=os.getenv("BOOTSTRAP_ORG_NAME"))
    parser.add_argument("--org-slug", default=os.getenv("BOOTSTRAP_ORG_SLUG"))
    parser.add_argument("--property-name", default=os.getenv("BOOTSTRAP_PROPERTY_NAME"))
    parser.add_argument("--admin-name", default=os.getenv("BOOTSTRAP_ADMIN_NAME"))
    parser.add_argument("--admin-email", default=os.getenv("BOOTSTRAP_ADMIN_EMAIL"))
    parser.add_argument("--password", default=os.getenv("BOOTSTRAP_ADMIN_PASSWORD"))
    parser.add_argument("--address", default=os.getenv("BOOTSTRAP_ADDRESS", ""))
    parser.add_argument("--city", default=os.getenv("BOOTSTRAP_CITY", ""))
    parser.add_argument("--state", default=os.getenv("BOOTSTRAP_STATE", ""))
    parser.add_argument("--pincode", default=os.getenv("BOOTSTRAP_PINCODE", ""))
    parser.add_argument("--timezone", default=os.getenv("BOOTSTRAP_TIMEZONE", "Asia/Kolkata"))
    args = parser.parse_args(argv)
    missing = [
        flag
        for flag, value in [
            ("org-name", args.org_name),
            ("org-slug", args.org_slug),
            ("property-name", args.property_name),
            ("admin-name", args.admin_name),
            ("admin-email", args.admin_email),
            ("password / BOOTSTRAP_ADMIN_PASSWORD", args.password),
        ]
        if not value
    ]
    if missing:
        parser.error("missing required values: " + ", ".join(missing))
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    try:
        with session_scope() as db:
            org, prop, admin = bootstrap(
                db,
                org_name=args.org_name,
                org_slug=args.org_slug,
                property_name=args.property_name,
                admin_name=args.admin_name,
                admin_email=args.admin_email,
                admin_password=args.password,
                address_line=args.address,
                city=args.city,
                state=args.state,
                pincode=args.pincode,
                timezone=args.timezone,
            )
            print("Bootstrap complete.")
            print(f"  Organization: {org.name} ({org.slug})")
            print(f"  Property:     {prop.name} ({prop.id})")
            print(f"  Join code:    {prop.join_code}")
            print(f"  Administrator:{admin.email} ({admin.id})")
    except BootstrapError as exc:
        print(f"Bootstrap refused: {exc}")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover - operational entry point
    raise SystemExit(main())
