import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import (
    AuthError,
    ConflictError,
    NotFoundError,
    ServiceUnavailableError,
    ValidationError,
)
from app.core.security import (
    create_access_token,
    generate_pass_token,
    generate_refresh_token,
    hash_password,
    password_needs_rehash,
    sha256_hex,
    verify_password,
)
from app.core.time import utcnow
from app.models import (
    Apartment,
    GuardProfile,
    Organization,
    PasswordResetToken,
    Property,
    RefreshToken,
    ResidentProfile,
    User,
)
from app.models.enums import Role
from app.schemas.auth import RegisterRequest, StaffCreateRequest
from app.services import audit_service, mail_service

logger = logging.getLogger("parkvanta.auth")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _issue_tokens(db: Session, user: User) -> tuple[str, str]:
    access = create_access_token(
        user_id=user.id, organization_id=user.organization_id, role=user.role
    )
    raw_refresh, refresh_hash, expires_at = generate_refresh_token()
    db.add(RefreshToken(user_id=user.id, token_hash=refresh_hash, expires_at=expires_at))
    return access, raw_refresh


def register_resident(db: Session, payload: RegisterRequest) -> User:
    prop = db.get(Property, payload.property_id)
    if (
        prop is None
        or not prop.is_active
        or prop.join_code != payload.join_code.strip().upper()
    ):
        # The join code is a capability; do not reveal whether the property exists.
        raise NotFoundError("Join code not found or the property is inactive")
    apartment = db.get(Apartment, payload.apartment_id)
    if apartment is None or apartment.property_id != prop.id:
        raise ValidationError("Apartment does not belong to the selected property")

    email = normalize_email(payload.email)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("An account with this email already exists")

    user = User(
        organization_id=prop.organization_id,
        property_id=prop.id,
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        phone=payload.phone,
        role=Role.RESIDENT.value,
    )
    db.add(user)
    db.flush()
    db.add(ResidentProfile(user_id=user.id, apartment_id=apartment.id, is_verified=False))
    audit_service.record(
        db,
        action="auth.register",
        entity_type="user",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=user.id,
        details={"role": user.role, "apartment_id": str(apartment.id)},
    )
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> tuple[User, str, str]:
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None or not verify_password(password, user.password_hash):
        # Same message and shape for unknown accounts and wrong passwords.
        audit_service.record(
            db,
            action="auth.login_failed",
            entity_type="user",
            organization_id=user.organization_id if user else None,
            details={"email": normalize_email(email)},
        )
        db.commit()
        raise AuthError("Invalid email or password")

    if not user.is_active or user.is_suspended:
        raise AuthError("This account is not active. Contact your society administrator.")

    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    user.last_login_at = utcnow()
    access, refresh = _issue_tokens(db, user)
    audit_service.record(
        db,
        action="auth.login",
        entity_type="user",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=user.id,
    )
    db.commit()
    db.refresh(user)
    return user, access, refresh


def rotate_refresh_token(db: Session, raw_token: str) -> tuple[User, str, str]:
    token_hash = sha256_hex(raw_token)
    token = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == token_hash).with_for_update()
    )
    if token is None:
        raise AuthError("Refresh token is invalid")

    if token.revoked_at is not None:
        # A previously rotated token is being replayed: revoke the whole family.
        db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=utcnow())
        )
        audit_service.record(
            db,
            action="auth.refresh_reuse_detected",
            entity_type="user",
            actor_user_id=token.user_id,
            entity_id=token.user_id,
        )
        db.commit()
        raise AuthError("Refresh token has already been used. Sign in again.")

    if token.expires_at <= utcnow():
        token.revoked_at = utcnow()
        db.commit()
        raise AuthError("Refresh token has expired")

    user = db.get(User, token.user_id)
    if user is None or not user.is_active or user.is_suspended:
        raise AuthError("Account is not active")

    access, raw_refresh = _issue_tokens(db, user)
    new_hash = sha256_hex(raw_refresh)
    token.revoked_at = utcnow()
    token.replaced_by_hash = new_hash
    audit_service.record(
        db,
        action="auth.refresh_rotated",
        entity_type="user",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=user.id,
    )
    db.commit()
    return user, access, raw_refresh


def revoke_refresh_token(db: Session, raw_token: str) -> None:
    token = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == sha256_hex(raw_token)))
    if token is not None and token.revoked_at is None:
        token.revoked_at = utcnow()
        audit_service.record(
            db,
            action="auth.logout",
            entity_type="user",
            actor_user_id=token.user_id,
            entity_id=token.user_id,
        )
        db.commit()


def create_staff_account(db: Session, admin: User, payload: StaffCreateRequest) -> User:
    email = normalize_email(payload.email)
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise ConflictError("An account with this email already exists")

    prop: Property | None = None
    if payload.property_id is not None:
        prop = db.get(Property, payload.property_id)
        if prop is None:
            raise NotFoundError("Property not found")
        if admin.role != Role.SUPER_ADMIN.value and prop.organization_id != admin.organization_id:
            raise NotFoundError("Property not found")

    organization_id = prop.organization_id if prop is not None else admin.organization_id
    apartment: Apartment | None = None
    if payload.apartment_id is not None:
        apartment = db.get(Apartment, payload.apartment_id)
        if apartment is None:
            raise NotFoundError("Apartment not found")
        if prop is not None and apartment.property_id != prop.id:
            raise ValidationError("Apartment does not belong to the selected property")
        if prop is None:
            prop = db.get(Property, apartment.property_id)
            if prop is None:
                raise NotFoundError("Property not found")
            organization_id = prop.organization_id

    if (
        prop is not None
        and admin.role != Role.SUPER_ADMIN.value
        and prop.organization_id != admin.organization_id
    ):
        # Resolving a property through an apartment must not become a tenant
        # escape hatch for society administrators.
        raise NotFoundError("Property not found")

    user = User(
        organization_id=organization_id,
        property_id=prop.id if prop is not None else None,
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        phone=payload.phone,
        role=payload.role.value,
    )
    db.add(user)
    db.flush()

    if payload.role == Role.RESIDENT:
        assert apartment is not None
        db.add(ResidentProfile(user_id=user.id, apartment_id=apartment.id, is_verified=True))
    elif payload.role == Role.SECURITY_GUARD:
        assert prop is not None
        db.add(
            GuardProfile(user_id=user.id, property_id=prop.id, badge_number=payload.badge_number)
        )

    audit_service.record(
        db,
        action="auth.account_created",
        entity_type="user",
        organization_id=organization_id,
        actor_user_id=admin.id,
        entity_id=user.id,
        details={"role": user.role},
    )
    db.commit()
    db.refresh(user)
    return user


def request_password_reset(db: Session, email: str) -> None:
    """Create a reset token if the account exists; never reveal whether it does."""
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        return

    raw_token, token_hash = generate_pass_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=utcnow() + timedelta(minutes=30),
        )
    )
    audit_service.record(
        db,
        action="auth.password_reset_requested",
        entity_type="user",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=user.id,
    )
    db.commit()

    reset_url = f"{settings.app_public_url.rstrip('/')}/reset-password?token={raw_token}"
    try:
        mail_service.send_email(
            to=user.email,
            subject="Reset your ParkVanta password",
            body=(
                "A password reset was requested for your ParkVanta account.\n\n"
                f"Open this link within 30 minutes:\n{reset_url}\n\n"
                "If you did not request it, ignore this message."
            ),
        )
    except mail_service.MailNotConfigured as exc:
        if settings.is_production:
            logger.error("Password reset requested but SMTP is not configured")
            raise ServiceUnavailableError(
                "Password reset email is not configured. Contact your administrator."
            ) from exc
        # Development affordance only, and only when no transport exists.
        logger.warning("Password reset token for %s (dev only): %s", user.email, raw_token)
    except mail_service.MailDeliveryError as exc:
        logger.exception("Password reset email delivery failed for %s", user.email)
        raise ServiceUnavailableError(
            "Password reset email could not be delivered. Try again later."
        ) from exc


def reset_password(db: Session, raw_token: str, new_password: str) -> None:
    token = db.scalar(
        select(PasswordResetToken)
        .where(PasswordResetToken.token_hash == sha256_hex(raw_token))
        .with_for_update()
    )
    if token is None or token.used_at is not None or token.expires_at <= utcnow():
        raise ValidationError("Reset token is invalid or has expired")

    user = db.scalar(select(User).where(User.id == token.user_id).with_for_update())
    if user is None:
        raise ValidationError("Reset token is invalid or has expired")

    user.password_hash = hash_password(new_password)
    token.used_at = utcnow()
    db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )
    audit_service.record(
        db,
        action="auth.password_reset",
        entity_type="user",
        organization_id=user.organization_id,
        actor_user_id=user.id,
        entity_id=user.id,
    )
    db.commit()


def list_organizations(db: Session) -> list[Organization]:
    return list(db.scalars(select(Organization).order_by(Organization.name)))


def count_active_sessions(db: Session, user_id: UUID) -> int:
    return int(
        db.scalar(
            select(func.count(RefreshToken.id)).where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > datetime.now(UTC),
            )
        )
        or 0
    )
