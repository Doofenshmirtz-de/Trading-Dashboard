import time
import re
from fastapi import APIRouter, Depends, Query, HTTPException
from app.dependencies import get_current_user
from app.services import binance as binance_service
from app.core.exceptions import BinanceUnavailableError
from app.models.market import VALID_TIMEFRAMES
from app.core.logging import get_logger

router = APIRouter(prefix="/market", tags=["market"])
logger = get_logger()

TRADING_PAIR_REGEX = re.compile(r"^[A-Z]+/USDT:USDT$")


@router.get("/pairs")
async def list_pairs(current_user: dict = Depends(get_current_user)) -> list[dict]:
    t0 = time.time()
    pairs = await binance_service.get_pairs()
    latency = int((time.time() - t0) * 1000)
    logger.info(
        "Market pairs requested",
        extra={"user_id": current_user["user_id"], "latency_ms": latency},
    )
    return pairs


@router.get("/candles")
async def get_candles(
    symbol: str = Query(...),
    timeframe: str = Query(default="1h"),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
) -> list[dict]:
    if timeframe not in VALID_TIMEFRAMES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid timeframe '{timeframe}'. Must be one of {VALID_TIMEFRAMES}",
        )

    t0 = time.time()
    candles = await binance_service.get_candles(symbol, timeframe, limit)
    latency = int((time.time() - t0) * 1000)
    logger.info(
        "Market candles requested",
        extra={
            "user_id": current_user["user_id"],
            "symbol": symbol,
            "timeframe": timeframe,
            "latency_ms": latency,
        },
    )
    return candles


@router.get("/ticker")
async def get_ticker(
    symbol: str = Query(...),
    current_user: dict = Depends(get_current_user),
) -> dict:
    t0 = time.time()
    ticker = await binance_service.get_ticker(symbol)
    latency = int((time.time() - t0) * 1000)
    logger.info(
        "Market ticker requested",
        extra={
            "user_id": current_user["user_id"],
            "symbol": symbol,
            "latency_ms": latency,
        },
    )
    return ticker
