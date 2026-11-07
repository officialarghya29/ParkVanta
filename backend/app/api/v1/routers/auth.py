from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.deps import CurrentUser, client_ip, require_roles
from app.core.errors import AuthError
from app.core.rate_limit import SlidingWindowRateLimiter
from app.database.session import get_db
from app.models import User
from app.models.enums import Role
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    StaffCreateRequest,
    TokenResponse,
    UserOut,
)
from app.schemas.common import Message
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])
login_limiter = SlidingWindowRateLimiter(settings.login_rate_limit, settings.login_rate_window_seconds)
refresh_limiter = SlidingWindowRateLimiter(30, 60)
forgot_limiter = SlidingWindowRateLimiter(5, 300)

COOKIE_NAME = "parkvanta_refresh"
COOKIE_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.is_production,
        samesite="lax",
        max_age=settings.refresh_token_days * 24 * 3600,
        path=COOKIE_PATH,
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Annotated[Session, Depends(get_db)]) -> UserOut:
    user = auth_service.register_resident(db, payload)
    return UserOut.model_validate(user)


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    email = auth_service.normalize_email(payload.email)
    login_limiter.hit(SlidingWindowRateLimiter.key_for("login", email, client_ip(request)))
    user, access, refresh = auth_service.authenticate(db, email, payload.password)
    _set_refresh_cookie(response, refresh)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh_tokens(
    payload: RefreshRequest,
    request: Request,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
) -> TokenResponse:
    raw = payload.refresh_token or request.cookies.get(COOKIE_NAME)
    if not raw:
        raise AuthError("No refresh token supplied")
    refresh_limiter.hit(SlidingWindowRateLimiter.key_for("refresh", client_ip(request)))
    user, access, new_refresh = auth_service.rotate_refresh_token(db, raw)
    _set_refresh_cookie(response, new_refresh)
    return TokenResponse(
        access_token=access,
        refresh_token=new_refresh,
        expires_in=settings.access_token_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/logout", response_model=Message)
def logout(payload: RefreshRequest, request: Request, response: Response, db: Annotated[Session, Depends(get_db)]) -> Message:
    raw = payload.refresh_token or request.cookies.get(COOKIE_NAME)
    if raw:
        auth_service.revoke_refresh_token(db, raw)
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)
    return Message(message="Signed out")


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post(
    "/users",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a staff or resident account (administrators only)",
)
def create_account(
    payload: StaffCreateRequest,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_roles(Role.SUPER_ADMIN, Role.SOCIETY_ADMIN))],
) -> UserOut:
    user = auth_service.create_staff_account(db, admin, payload)
    return UserOut.model_validate(user)


@router.post("/forgot-password", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
def forgot_password(
    payload: ForgotPasswordRequest,
    request: Request,
    db: Annotated[Session, Depends(get_db)],
) -> Message:
    email = auth_service.normalize_email(payload.email)
    forgot_limiter.hit(SlidingWindowRateLimiter.key_for("forgot", email, client_ip(request)))
    auth_service.request_password_reset(db, email)
    return Message(message="If an account exists for this email, a reset link has been issued")


@router.post("/reset-password", response_model=Message)
def reset_password(payload: ResetPasswordRequest, db: Annotated[Session, Depends(get_db)]) -> Message:
    auth_service.reset_password(db, payload.token, payload.new_password)
    return Message(message="Password updated. Sign in with your new password.")

