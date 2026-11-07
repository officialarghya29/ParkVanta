from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

from app.core.errors import AppError
from app.database.session import SessionLocal
from app.models import Invitation, ParkingReservation, QRPass, User
from app.models.enums import PassStatus, ReservationStatus
from app.services import gate_service, parking_service


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _create_pending_invitation(client, token, plate: str) -> dict:
    arrival = datetime.now(UTC) + timedelta(minutes=5)
    response = client.post(
        "/api/v1/invitations",
        headers=auth(token),
        json={
            "visitor_name": f"Visitor {plate[-4:]}",
            "visitor_phone": None,
            "vehicle_registration": plate,
            "vehicle_category": "FOUR_WHEELER",
            "visitor_type": "GUEST",
            "expected_arrival": arrival.isoformat(),
            "expected_departure": (arrival + timedelta(hours=1)).isoformat(),
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_single_use_pass_survives_concurrent_authorizations(client, world, tokens):
    invitation = _create_pending_invitation(client, tokens["resident"], "KA03EF1111")
    approval = client.post(
        f"/api/v1/invitations/{invitation['id']}/approve", headers=auth(tokens["resident"])
    ).json()
    raw_token = approval["pass_token"]

    barrier = Barrier(2)
    outcomes: list[str] = []

    def attempt() -> None:
        db = SessionLocal()
        try:
            guard = db.get(User, world["guard_id"])
            barrier.wait(timeout=10)
            gate_service.authorize_entry(
                db,
                guard=guard,
                token=raw_token,
                plate_number="KA03EF1111",
                ip_address="127.0.0.1",
            )
            outcomes.append("authorized")
        except AppError as exc:
            outcomes.append(exc.code)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: attempt(), range(2)))

    assert sorted(outcomes) == ["already_used", "authorized"]

    with SessionLocal() as db:
        pass_row = db.query(QRPass).filter(QRPass.invitation_id == invitation["id"]).one()
        assert pass_row.status == PassStatus.CONSUMED.value
        entries = [
            event
            for event in db.query(gate_service.EntryExitEvent).filter(
                gate_service.EntryExitEvent.invitation_id == invitation["id"],
                gate_service.EntryExitEvent.direction == "ENTRY",
            )
        ]
        assert len(entries) == 1


def test_concurrent_allocations_never_double_book_a_slot(client, world, tokens):
    first = _create_pending_invitation(client, tokens["resident"], "KA04GH2222")
    second = _create_pending_invitation(client, tokens["resident"], "KA04GH3333")

    barrier = Barrier(2)
    outcomes: list[str] = []

    def allocate(invitation_id: str) -> None:
        db = SessionLocal()
        try:
            invitation = db.get(Invitation, invitation_id)
            barrier.wait(timeout=10)
            parking_service.allocate_for_invitation(db, invitation=invitation)
            db.commit()
            outcomes.append("allocated")
        except AppError as exc:
            db.rollback()
            outcomes.append(exc.code)
        finally:
            db.close()

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(allocate, [first["id"], second["id"]]))

    assert sorted(outcomes) == ["allocated", "no_slot_available"]

    with SessionLocal() as db:
        active = (
            db.query(ParkingReservation)
            .filter(ParkingReservation.status == ReservationStatus.ACTIVE.value)
            .all()
        )
        assert len(active) == 1
        assert active[0].slot_id == world["slot_id"]
