from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.database.session import get_db
from app.models import Apartment, Property, Tower
from app.schemas.tenancy import JoinApartmentOut, JoinPropertyOut

router = APIRouter(prefix="/public", tags=["Public onboarding"])


@router.get("/join/{join_code}", response_model=JoinPropertyOut)
def lookup_join_code(
    join_code: Annotated[str, Path(min_length=8, max_length=16)],
    db: Annotated[Session, Depends(get_db)],
) -> JoinPropertyOut:
    """Resolve a society join code to the apartments a resident can claim.

    The join code is a capability: it must be shared deliberately by the
    society. It never exposes residents, contact details or parking inventory.
    """
    prop = db.scalar(
        select(Property).where(
            Property.join_code == join_code.strip().upper(),
            Property.is_active.is_(True),
        )
    )
    if prop is None:
        raise NotFoundError("Join code not found or the property is inactive")

    rows = db.execute(
        select(Apartment, Tower.name)
        .outerjoin(Tower, Apartment.tower_id == Tower.id)
        .where(Apartment.property_id == prop.id)
        .order_by(Tower.name, Apartment.number)
    ).all()
    return JoinPropertyOut(
        property_id=prop.id,
        name=prop.name,
        address_line=prop.address_line,
        city=prop.city,
        state=prop.state,
        apartments=[
            JoinApartmentOut(
                id=apartment.id,
                number=apartment.number,
                floor=apartment.floor,
                tower_name=tower_name,
            )
            for apartment, tower_name in rows
        ],
    )
