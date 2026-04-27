# KNOWN LIMITATIONS — MVP
# TODO Phase 3: Replace in-memory pair cache with Redis
# TODO Phase 3: Replace REST ticker polling with WebSocket streaming
# TODO Phase 3: Replace raw JSONB config with typed per-bot-type schemas
# TODO Phase 3: Add cursor-based pagination for bots and pairs
# TODO Phase 4: Add Celery worker for background bot execution
# TODO Phase 4: Add virtual portfolio engine with slippage simulation

import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.logging import setup_logging, get_logger
from app.core.exceptions import (
    BinanceUnavailableError,
    InvalidBotTransitionError,
    BotNotFoundError,
    UnauthorizedError,
)
from app.routers import health, bots, market

setup_logging()
logger = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Trading Bot Arena API starting",
        extra={"environment": settings.ENVIRONMENT},
    )
    yield
    logger.info("Trading Bot Arena API shutting down")


app = FastAPI(
    title="Trading Bot Arena API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(UnauthorizedError)
async def unauthorized_handler(request: Request, exc: UnauthorizedError) -> JSONResponse:
    return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})


@app.exception_handler(BotNotFoundError)
async def bot_not_found_handler(request: Request, exc: BotNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": "Bot not found"})


@app.exception_handler(InvalidBotTransitionError)
async def invalid_transition_handler(
    request: Request, exc: InvalidBotTransitionError
) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(BinanceUnavailableError)
async def binance_unavailable_handler(
    request: Request, exc: BinanceUnavailableError
) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": "Binance API temporarily unavailable. Please try again."},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled exception",
        extra={"error": str(exc), "traceback": traceback.format_exc()},
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


app.include_router(health.router)
app.include_router(bots.router)
app.include_router(market.router)


@app.get("/")
async def root() -> dict:
    return {"status": "ok", "service": "Trading Bot Arena API"}
