import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.models.enums import Role
from app.schemas.common import ORMModel


def _validate_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Password must be at least 8 characters long")
    if not re.search(r"[A-Za-z]", value) or not re.search(r"\d", value):
        raise ValueError("Password must contain both letters and digits")
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=20)
    property_id: UUID
    apartment_id: UUID
    join_code: str = Field(min_length=16, max_length=16, pattern=r"^[A-Fa-f0-9]{16}$")

    _password = field_validator("password")(_validate_password)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(ORMModel):
    id: UUID
    organization_id: UUID
    property_id: UUID | None
    email: EmailStr
    full_name: str
    phone: str | None
    role: Role
    is_active: bool
    last_login_at: datetime | None


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=16, max_length=256)
    new_password: str = Field(min_length=8, max_length=128)

    _password = field_validator("new_password")(_validate_password)


class StaffCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=20)
    role: Role
    property_id: UUID | None = None
    apartment_id: UUID | None = None
    badge_number: str | None = Field(default=None, max_length=40)

    _password = field_validator("password")(_validate_password)

    @model_validator(mode="after")
    def _role_requirements(self) -> "StaffCreateRequest":
        if self.role == Role.RESIDENT and self.apartment_id is None:
            raise ValueError("Residents must be assigned an apartment")
        if self.role == Role.SECURITY_GUARD and self.property_id is None:
            raise ValueError("Guards must be assigned a property")
        if self.role == Role.SUPER_ADMIN:
            raise ValueError("The super admin account is provisioned by the platform bootstrapper")
        return self


class ResidentUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    phone: str | None = Field(default=None, max_length=20)
    is_verified: bool | None = None
    is_suspended: bool | None = None
