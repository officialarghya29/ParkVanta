"""Development seed data.

Creates one organization, one property, towers, apartments, parking inventory,
policies and demo accounts. Safe to run repeatedly.

    python -m app.seed
"""

import os

from sqlalchemy import select

from app.core.security import hash_password
from app.database.session import session_scope
from app.models import (
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
from app.models.enums import Role, VehicleCategory, ZoneCategory
from app.services import parking_service

DEMO_PASSWORD = os.getenv("SEED_PASSWORD", "ParkVanta@2026")


def main() -> None:
    with session_scope() as db:
        existing = db.scalar(select(Organization).where(Organization.slug == "skyline"))
        if existing is not None:
            print("Seed skipped: demo organization already exists.")
            return

        platform = Organization(name="ParkVanta Platform", slug="parkvanta-platform")
        org = Organization(name="Skyline Communities", slug="skyline")
        db.add_all([platform, org])
        db.flush()

        prop = Property(
            organization_id=org.id,
            name="Skyline Residency",
            address_line="12 Orchid Avenue, Whitefield",
            city="Bengaluru",
            state="Karnataka",
            pincode="560066",
            timezone="Asia/Kolkata",
        )
        db.add(prop)
        db.flush()
        parking_service.ensure_policy(db, property_id=prop.id)

        tower_a = Tower(property_id=prop.id, name="Tower A", floors=12)
        tower_b = Tower(property_id=prop.id, name="Tower B", floors=12)
        db.add_all([tower_a, tower_b])
        db.flush()

        apartments: list[Apartment] = []
        for floor in (1, 2):
            apartments.append(Apartment(property_id=prop.id, tower_id=tower_a.id, number=f"A-10{floor}", floor=floor))
            apartments.append(Apartment(property_id=prop.id, tower_id=tower_b.id, number=f"B-20{floor}", floor=floor))
        db.add_all(apartments)
        db.flush()

        visitor_zone = ParkingZone(
            property_id=prop.id,
            name="Visitor Bay North",
            level="Ground",
            category=ZoneCategory.VISITOR.value,
            priority=10,
        )
        service_zone = ParkingZone(
            property_id=prop.id,
            name="Service Bay",
            level="Ground",
            category=ZoneCategory.SERVICE.value,
            priority=20,
        )
        reserved_zone = ParkingZone(
            property_id=prop.id,
            name="Reserved Bay East",
            level="Basement 1",
            category=ZoneCategory.RESERVED.value,
            priority=30,
        )
        db.add_all([visitor_zone, service_zone, reserved_zone])
        db.flush()

        for index in range(1, 11):
            db.add(
                ParkingSlot(
                    property_id=prop.id,
                    zone_id=visitor_zone.id,
                    code=f"V-{index:02d}",
                    category=visitor_zone.category,
                    vehicle_category=VehicleCategory.FOUR_WHEELER.value,
                )
            )
        for index in range(1, 5):
            db.add(
                ParkingSlot(
                    property_id=prop.id,
                    zone_id=visitor_zone.id,
                    code=f"V-2W-{index:02d}",
                    category=visitor_zone.category,
                    vehicle_category=VehicleCategory.TWO_WHEELER.value,
                )
            )
        db.add_all(
            [
                ParkingSlot(
                    property_id=prop.id,
                    zone_id=service_zone.id,
                    code="S-01",
                    category=service_zone.category,
                    vehicle_category="ANY",
                ),
                ParkingSlot(
                    property_id=prop.id,
                    zone_id=service_zone.id,
                    code="S-02",
                    category=service_zone.category,
                    vehicle_category="ANY",
                ),
                ParkingSlot(
                    property_id=prop.id,
                    zone_id=reserved_zone.id,
                    code="R-01",
                    category=reserved_zone.category,
                    vehicle_category=VehicleCategory.FOUR_WHEELER.value,
                ),
            ]
        )
        db.flush()

        accounts = [
            ("superadmin@parkvanta.dev", "Platform Owner", Role.SUPER_ADMIN, platform.id, None),
            ("admin@skyline.dev", "Ananya Rao", Role.SOCIETY_ADMIN, org.id, prop.id),
            ("manager@skyline.dev", "Vikram Menon", Role.PROPERTY_MANAGER, org.id, prop.id),
            ("guard@skyline.dev", "Suresh Kumar", Role.SECURITY_GUARD, org.id, prop.id),
            ("resident@skyline.dev", "Arghya Bose", Role.RESIDENT, org.id, prop.id),
        ]
        created: dict[str, User] = {}
        for email, name, role, organization_id, property_id in accounts:
            user = User(
                organization_id=organization_id,
                property_id=property_id,
                email=email,
                password_hash=hash_password(DEMO_PASSWORD),
                full_name=name,
                role=role.value,
            )
            db.add(user)
            db.flush()
            created[email] = user

        db.add(
            ResidentProfile(
                user_id=created["resident@skyline.dev"].id,
                apartment_id=apartments[0].id,
                is_verified=True,
            )
        )
        db.add(
            GuardProfile(
                user_id=created["guard@skyline.dev"].id,
                property_id=prop.id,
                badge_number="GRD-104",
            )
        )

        db.commit()

    print("Seed complete.")
    print(f"  Society:  {prop.name} (property id {prop.id})")
    print(f"  Slots:    {len(apartments)} apartments · 17 parking slots")
    print(f"  Password: {DEMO_PASSWORD} (all demo accounts)")
    for email, name, role, *_ in accounts:
        print(f"  {role.value:<16} {email:<28} {name}")


if __name__ == "__main__":
    main()
