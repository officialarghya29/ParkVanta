import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import settings

# Argon2id is the default variant for argon2-cffi. Parameters are tuned to be
# expensive enough for interactive login while staying usable on small VMs.
password_hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=4, hash_len=32, salt_len=16)


class TokenError(Exception):
    """Raised when a JWT cannot be trusted."""


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    try:
        return password_hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


def create_access_token(*, user_id: UUID, organization_id: UUID, role: str) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "org": str(organization_id),
        "role": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
        "jti": secrets.token_hex(16),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Access token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Access token is invalid") from exc
    if payload.get("type") != "access":
        raise TokenError("Access token has an unexpected type")
    return payload


def generate_refresh_token() -> tuple[str, str, datetime]:
    """Return (raw token, sha256 hash, expiry). Only the hash is persisted."""
    raw = secrets.token_urlsafe(48)
    return raw, sha256_hex(raw), datetime.now(UTC) + timedelta(days=settings.refresh_token_days)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_pass_token() -> tuple[str, str]:
    """Return (raw QR pass token, hash). 256 bits of CSPRNG entropy."""
    raw = secrets.token_urlsafe(32)
    return raw, sha256_hex(raw)
