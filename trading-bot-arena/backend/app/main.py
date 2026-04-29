# KNOWN LIMITATIONS — MVP
# TODO Phase 3: Replace in-memory pair cache with Redis
# TODO Phase 3: Replace REST ticker polling with WebSocket streaming
# TODO Phase 4: Replace APScheduler with Celery + Redis workers
#   - Railway free tier may pause container → APScheduler jobs stop
#   - Multiple Railway instances = duplicate ticks (no distributed lock)
#   - max_instances=1 prevents overlap on a single instance only
# TODO Phase 4: Add distributed lock (Redis/Supabase advisory locks) for multi-instance safety
# TODO Phase 4: WebSocket/SSE for real-time signal push to frontend

import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.config import settings
from app.core.logging import setup_logging, get_logger
from app.core.exceptions import (
    BinanceUnavailableError,
    InvalidBotTransitionError,
    BotNotFoundError,
    UnauthorizedError,
)
from app.routers import health, bots, market
from app.services.bot_runner import bot_runner, TIMEFRAME_SECONDS

setup_logging()
logger = get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "Trading Bot Arena API starting",
        extra={"environment": settings.ENVIRONMENT},
    )

    # Load all bots that were running before restart
    await bot_runner.load_running_bots()

    # One scheduler job per timeframe — fires exactly on the candle boundary
    scheduler = AsyncIOScheduler()
    for tf, seconds in TIMEFRAME_SECONDS.items():
        scheduler.add_job(
            bot_runner.tick_timeframe,
            "interval",
            seconds=seconds,
            args=[tf],
            id=f"tick_{tf}",
            max_instances=1,  # prevents overlap if a tick takes longer than interval
        )
    scheduler.start()
    logger.info("Scheduler started", extra={"jobs": list(TIMEFRAME_SECONDS.keys())})

    yield

    scheduler.shutdown(wait=False)
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
