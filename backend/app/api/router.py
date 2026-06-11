from fastapi import APIRouter

from app.api.ai_concierge import router as ai_concierge_router
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.instay import router as instay_router
from app.api.listings import router as listings_router
from app.api.ops import router as ops_router
from app.api.payments import router as payments_router
from app.api.reservations import router as reservations_router
from app.api.support import router as support_router

api_router = APIRouter()
api_router.include_router(ai_concierge_router)
api_router.include_router(analytics_router)
api_router.include_router(auth_router)
api_router.include_router(chat_router)
api_router.include_router(instay_router)
api_router.include_router(listings_router)
api_router.include_router(ops_router)
api_router.include_router(payments_router)
api_router.include_router(reservations_router)
api_router.include_router(support_router)
