import logging

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.database.session import engine

configure_logging("DEBUG" if settings.debug else "INFO")
logger = logging.getLogger("parkvanta")

app = FastAPI(
    title="ParkVanta API",
    version="0.1.0",
    summary="Smart access and visitor parking management for residential communities.",
    description=(
        "Visitor verification, single-use QR passes, concurrency-safe parking allocation, "
        "gate operations and operational analytics. All state is tenant-scoped."
    ),
    openapi_url=f"{settings.api_v1_prefix}/openapi.json",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.on_event("startup")
def _startup_checks() -> None:
    settings.validate_for_production()
    logger.info("ParkVanta API starting in %s mode", settings.environment)


@app.exception_handler(AppError)
async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {"code": exc.code, "message": exc.message, "details": exc.details},
        },
    )


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "The submitted data is invalid.",
                "details": jsonable_encoder(exc.errors()),
            }
        },
    )


@app.exception_handler(IntegrityError)
async def handle_integrity_error(request: Request, exc: IntegrityError) -> JSONResponse:
    logger.warning("Database integrity conflict: %s", exc.orig)
    return JSONResponse(
        status_code=409,
        content={
            "error": {
                "code": "conflict",
                "message": "The operation conflicts with existing data.",
                "details": None,
            }
        },
    )


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "internal_error",
                "message": "An unexpected error occurred.",
                "details": None,
            }
        },
    )


@app.get("/health", tags=["Health"], summary="Liveness probe")
def health() -> dict:
    return {"status": "ok", "service": settings.app_name, "environment": settings.environment}


@app.get("/ready", tags=["Health"], summary="Readiness probe (checks the database)")
def ready() -> dict:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ready", "database": "ok"}


app.include_router(api_router, prefix=settings.api_v1_prefix)
