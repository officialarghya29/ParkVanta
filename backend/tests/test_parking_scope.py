from sqlalchemy import select

from app.models import ParkingSlot, ParkingZone, User
from app.models.enums import ZoneCategory


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_available_slots_for_society_wide_admin_stay_inside_organization(
    client, world, tokens, db_session
):
    other_zone = ParkingZone(
        property_id=world["other_property_id"],
        name="Rival Visitor Bay",
        category=ZoneCategory.VISITOR.value,
    )
    db_session.add(other_zone)
    db_session.flush()
    db_session.add(
        ParkingSlot(
            property_id=world["other_property_id"],
            zone_id=other_zone.id,
            code="RIVAL-01",
            category=ZoneCategory.VISITOR.value,
            vehicle_category="ANY",
        )
    )
    admin = db_session.scalar(select(User).where(User.email == world["admin_email"]))
    admin.property_id = None
    db_session.commit()

    response = client.get("/api/v1/parking/slots/available", headers=auth(tokens["admin"]))

    assert response.status_code == 200, response.text
    codes = {slot["code"] for slot in response.json()}
    assert "V-01" in codes
    assert "RIVAL-01" not in codes
