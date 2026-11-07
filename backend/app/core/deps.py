from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.errors import AuthError, ForbiddenError, NotFoundError
from app.core.security import TokenError, decode_access_token
from app.database.session import get_db
from app.models import Property, User
from app.models.enums import Role

bearer_scheme = HTTPBearer(auto_error=False, description="ParkVanta access token")

DB = Annotated[Session, Depends(get_db)]


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DB,
) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthError("Missing bearer token")

    try:
        payload = decode_access_token(credentials.credentials)
    except TokenError as exc:
        raise AuthError(str(exc)) from exc

    try:
        user_id = UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise AuthError("Access token subject is invalid") from exc

    user = db.get(User, user_id)
    if user is None:
        raise AuthError("Account no longer exists")
    if not user.is_active or user.is_suspended:
        raise AuthError("Account is not active")
    if payload.get("org") != str(user.organization_id):
        raise AuthError("Access token does not match the account organization")
    if payload.get("role") != user.role:
        raise AuthError("Access token role is stale, please sign in again")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_roles(*roles: Role | str) -> Callable[..., User]:
    allowed = {role.value if isinstance(role, Role) else role for role in roles}

    def dependency(user: CurrentUser) -> User:
        if user.role == Role.SUPER_ADMIN.value:
            return user
        if user.role not in allowed:
            raise ForbiddenError()
        return user

    return dependency


def assert_org_access(user: User, organization_id: UUID) -> None:
    """Every tenant-scoped read and write passes through this boundary."""
    if user.role == Role.SUPER_ADMIN.value:
        return
    if user.organization_id != organization_id:
        # Deliberately 404-shaped at call sites to avoid tenant enumeration.
        raise ForbiddenError("Cross-organization access is not permitted")


def assert_property_access(db: Session, user: User, property_id: UUID) -> Property:
    prop = db.get(Property, property_id)
    if prop is None:
        raise NotFoundError("Property not found")
    assert_org_access(user, prop.organization_id)
    if user.role == Role.SUPER_ADMIN.value:
        return prop
    if user.property_id is not None and user.property_id != prop.id:
        raise ForbiddenError("You are not assigned to this property")
    return prop


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
