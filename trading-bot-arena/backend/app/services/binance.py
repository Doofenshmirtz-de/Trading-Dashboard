import time
import ccxt.async_support as ccxt_async
from app.config import settings
from app.core.exceptions import BinanceUnavailableError
from app.models.market import VALID_TIMEFRAMES
from app.core.logging import get_logger

logger = get_logger()

_exchange: ccxt_async.binanceusdm | None = None

_cache: dict = {
    "pairs": {"data": None, "cached_at": 0.0},
}

PAIRS_CACHE_TTL = 3600


def _get_exchange() -> ccxt_async.binanceusdm:
    global _exchange
    if _exchange is None:
        config: dict = {"enableRateLimit": True}
        if settings.BINANCE_API_KEY and settings.BINANCE_SECRET:
            config["apiKey"] = settings.BINANCE_API_KEY
            config["secret"] = settings.BINANCE_SECRET
        _exchange = ccxt_async.binanceusdm(config)
    return _exchange


async def get_pairs() -> list[dict]:
    now = time.time()
    cached = _cache["pairs"]
    if cached["data"] is not None and (now - cached["cached_at"]) < PAIRS_CACHE_TTL:
        return cached["data"]  # type: ignore[return-value]

    exchange = _get_exchange()
    t0 = time.time()
    try:
        markets = await exchange.load_markets()
        pairs = [
            {
                "symbol": m["symbol"],
                "base": m["base"],
                "quote": m["quote"],
                "active": m.get("active", True),
            }
            for m in markets.values()
            if m.get("swap") and m["symbol"].endswith("/USDT:USDT")
        ]
        latency = int((time.time() - t0) * 1000)
        logger.info(
            "Binance pairs fetched",
            extra={"latency_ms": latency, "pair_count": len(pairs)},
        )
        _cache["pairs"] = {"data": pairs, "cached_at": now}
        return pairs
    except ccxt_async.NetworkError as e:
        logger.error("Binance network error fetching pairs", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e
    except Exception as e:
        logger.error("Binance unexpected error fetching pairs", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e


async def get_candles(symbol: str, timeframe: str, limit: int) -> list[dict]:
    if timeframe not in VALID_TIMEFRAMES:
        raise ValueError(
            f"Invalid timeframe '{timeframe}'. Must be one of {VALID_TIMEFRAMES}"
        )

    exchange = _get_exchange()
    t0 = time.time()
    try:
        ohlcv = await exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        latency = int((time.time() - t0) * 1000)
        logger.info(
            "Binance candles fetched",
            extra={
                "symbol": symbol,
                "timeframe": timeframe,
                "limit": limit,
                "latency_ms": latency,
            },
        )
        return [
            {
                "timestamp": row[0],
                "open": row[1],
                "high": row[2],
                "low": row[3],
                "close": row[4],
                "volume": row[5],
            }
            for row in ohlcv
        ]
    except ccxt_async.NetworkError as e:
        logger.error("Binance network error fetching candles", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e
    except Exception as e:
        logger.error("Binance error fetching candles", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e


async def get_ticker(symbol: str) -> dict:
    exchange = _get_exchange()
    t0 = time.time()
    try:
        raw = await exchange.fetch_ticker(symbol)
        latency = int((time.time() - t0) * 1000)
        logger.info(
            "Binance ticker fetched",
            extra={"symbol": symbol, "latency_ms": latency},
        )
        return {
            "symbol": symbol,
            "last": raw.get("last"),
            "change": raw.get("percentage"),
            "high": raw.get("high"),
            "low": raw.get("low"),
            "volume": raw.get("baseVolume"),
        }
    except ccxt_async.NetworkError as e:
        logger.error("Binance network error fetching ticker", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e
    except Exception as e:
        logger.error("Binance error fetching ticker", extra={"error": str(e)})
        raise BinanceUnavailableError(str(e)) from e


async def get_historical_candles(
    symbol: str,
    timeframe: str,
    since_ms: int,
    until_ms: int,
    max_candles: int = 3000,
) -> list[dict]:
    """
    Fetch historical OHLCV data between since_ms and until_ms (epoch ms).
    Paginates across multiple Binance requests (max 1000 per request).
    """
    if timeframe not in VALID_TIMEFRAMES:
        raise ValueError(f"Invalid timeframe '{timeframe}'. Must be one of {VALID_TIMEFRAMES}")

    exchange = _get_exchange()
    all_candles: list[list] = []
    current_since = since_ms
    t0 = time.time()

    while len(all_candles) < max_candles:
        try:
            batch = await exchange.fetch_ohlcv(
                symbol, timeframe, since=current_since, limit=1000
            )
        except ccxt_async.NetworkError as e:
            if all_candles:
                logger.warning(
                    "Network error during candle pagination — stopping early",
                    extra={"error": str(e), "fetched_so_far": len(all_candles)},
                )
                break
            raise BinanceUnavailableError(str(e)) from e
        except Exception as e:
            if all_candles:
                logger.warning(
                    "Error during candle pagination — stopping early",
                    extra={"error": str(e), "fetched_so_far": len(all_candles)},
                )
                break
            raise BinanceUnavailableError(str(e)) from e

        if not batch:
            break

        filtered = [c for c in batch if c[0] <= until_ms]
        all_candles.extend(filtered)

        if len(filtered) < len(batch) or batch[-1][0] >= until_ms:
            break

        current_since = batch[-1][0] + 1

        if len(all_candles) >= max_candles:
            break

    latency = int((time.time() - t0) * 1000)
    logger.info(
        "Historical candles fetched",
        extra={
            "symbol": symbol,
            "timeframe": timeframe,
            "count": min(len(all_candles), max_candles),
            "latency_ms": latency,
        },
    )

    return [
        {
            "timestamp": c[0],
            "open": c[1],
            "high": c[2],
            "low": c[3],
            "close": c[4],
            "volume": c[5],
        }
        for c in all_candles[:max_candles]
    ]


async def check_connectivity() -> tuple[bool, int | None, str | None]:
    import asyncio

    exchange = _get_exchange()
    t0 = time.time()
    try:
        await asyncio.wait_for(exchange.fetch_time(), timeout=8.0)
        latency = int((time.time() - t0) * 1000)
        return True, latency, None
    except asyncio.TimeoutError:
        return False, None, "Binance connectivity check timed out (8s)"
    except Exception as e:
        return False, None, str(e)
