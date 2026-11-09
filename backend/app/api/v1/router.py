from fastapi import APIRouter

from app.api.v1.routers import (
    analytics,
    audit,
    auth,
    events,
    gate,
    invitations,
    parking,
    public,
    qr,
    tenancy,
)

api_router = APIRouter()
api_router.include_router(public.router)
api_router.include_router(auth.router)
api_router.include_router(tenancy.router)
api_router.include_router(invitations.router)
api_router.include_router(qr.router)
api_router.include_router(parking.router)
api_router.include_router(gate.router)
api_router.include_router(analytics.router)
api_router.include_router(audit.router)
api_router.include_router(events.router)
