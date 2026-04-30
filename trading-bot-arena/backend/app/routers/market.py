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


# ── Market Regime Endpoint ────────────────────────────────────────────────────

# Simples In-Memory Cache für Regime-Daten (TTL: 60 Sekunden)
_regime_cache: dict = {}
REGIME_CACHE_TTL_SECONDS = 60


@router.get("/regime")
async def get_market_regime(
    symbol: str = Query(default="BTC/USDT:USDT"),
    timeframe: str = Query(default="1h"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Get current market regime classification for a trading pair.
    
    Regimes:
    - TRENDING_UP: Strong uptrend (ADX > 25, price above SMA)
    - TRENDING_DOWN: Strong downtrend (ADX > 25, price below SMA)
    - RANGING: Low volatility, sideways (ADX < 20)
    - HIGH_VOLATILITY: Extreme volatility (BB Width > 10%)
    - UNKNOWN: Error fallback
    
    Cached for 60 seconds to reduce API load.
    """
    from app.services.regime_service import regime_service
    import time
    
    # Cache Key
    cache_key = f"{symbol}:{timeframe}"
    now = time.time()
    
    # Prüfe Cache
    if cache_key in _regime_cache:
        cached = _regime_cache[cache_key]
        if now - cached["cached_at"] < REGIME_CACHE_TTL_SECONDS:
            logger.info(
                "Market regime served from cache",
                extra={
                    "user_id": current_user["user_id"],
                    "symbol": symbol,
                    "timeframe": timeframe,
                    "regime": cached["data"]["regime"],
                },
            )
            return cached["data"]
    
    # Berechne frisches Regime
    t0 = time.time()
    result = await regime_service.detect_regime(symbol, timeframe)
    latency = int((time.time() - t0) * 1000)
    
    response = {
        "regime": result.regime.value,
        "pair": result.pair,
        "timeframe": result.timeframe,
        "timestamp": result.timestamp,
        "indicators": {
            "adx": result.adx,
            "bb_width_pct": result.bb_width_pct,
            "sma_slope": result.sma_slope,
            "plus_di": result.plus_di,
            "minus_di": result.minus_di,
        },
    }
    
    # Speichere im Cache
    _regime_cache[cache_key] = {
        "data": response,
        "cached_at": now,
    }
    
    logger.info(
        "Market regime calculated",
        extra={
            "user_id": current_user["user_id"],
            "symbol": symbol,
            "timeframe": timeframe,
            "regime": result.regime.value,
            "latency_ms": latency,
        },
    )
    
    return response
