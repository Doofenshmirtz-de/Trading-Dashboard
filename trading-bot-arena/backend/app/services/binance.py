import time
import httpx
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


_BINANCE_LEADERBOARD_BASE = "https://www.binance.com/bapi/futures/v1/public/future/leaderboard"
_BINANCE_LB_V2 = "https://www.binance.com/bapi/futures/v2/public/future/leaderboard"
_BINANCE_LB_V3 = "https://www.binance.com/bapi/futures/v3/public/future/leaderboard"

# Cache for leaderboard list (5-minute TTL)
_leaders_cache: dict[str, tuple[float, list]] = {}
_LEADERS_CACHE_TTL_S = 300

# Cache leader UID look-ups (portfolio_id → encrypted_uid) to avoid repeated calls
_leader_uid_cache: dict[str, str] = {}

# Short-lived position cache: portfolio_id → (timestamp_s, result_dict)
_leader_position_cache: dict[str, tuple[float, dict]] = {}
_LEADER_CACHE_TTL_S = 30  # cache leader positions for 30 seconds


async def get_copy_trading_leaders(
    sort_by: str = "ROI",
    period: str = "MONTHLY",
    limit: int = 20,
) -> list[dict]:
    """
    Fetch top Binance Lead Traders from the public leaderboard.

    sort_by: "ROI" | "PNL"
    period:  "DAILY" | "WEEKLY" | "MONTHLY" | "ALL"
    Returns a normalised list ready for the frontend.

    Tries multiple endpoint variants in order and returns the first successful result.
    """
    cache_key = f"{sort_by}:{period}:{limit}"
    now = time.time()
    cached = _leaders_cache.get(cache_key)
    if cached and (now - cached[0]) < _LEADERS_CACHE_TTL_S:
        return cached[1]

    # Proper browser headers — required to pass Cloudflare on Binance.
    # The cid cookie is set by Binance on page load; any short alphanumeric
    # value is accepted for the public leaderboard endpoint.
    headers = {
        "Content-Type": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Origin": "https://www.binance.com",
        "Referer": "https://www.binance.com/en/futures-activity/leaderboard",
        "Cookie": "cid=tba12345",
        "clienttype": "web",
        "lang": "en",
    }

    # Binance periodType mapping
    # "TOTAL" = all-time in Binance API, also try MONTHLY as fallback
    period_map = {"DAILY": "DAILY", "WEEKLY": "WEEKLY", "MONTHLY": "MONTHLY", "ALL": "TOTAL"}
    binance_period = period_map.get(period, "MONTHLY")

    # Try multiple body variants — isShared/isTrader behaviour differs by endpoint version
    body_variants = [
        # Variant 1: standard (isShared=True filters to traders who share positions)
        {"tradeType": "PERPETUAL", "statisticsType": sort_by, "periodType": binance_period, "isShared": True, "isTrader": False},
        # Variant 2: without isShared (broader result set)
        {"tradeType": "PERPETUAL", "statisticsType": sort_by, "periodType": binance_period, "isTrader": False},
        # Variant 3: MONTHLY fallback if TOTAL returns empty
        {"tradeType": "PERPETUAL", "statisticsType": sort_by, "periodType": "MONTHLY", "isShared": True, "isTrader": False},
        # Variant 4: MONTHLY without isShared
        {"tradeType": "PERPETUAL", "statisticsType": sort_by, "periodType": "MONTHLY", "isTrader": False},
    ]

    # Deduplicate: if period is already MONTHLY, no need to repeat monthly variants
    if binance_period == "MONTHLY":
        body_variants = body_variants[:2]

    # Try endpoints × body variants
    attempts = [
        (f"{_BINANCE_LB_V3}/getLeaderboardRank", bv)
        for bv in body_variants
    ] + [
        (f"{_BINANCE_LB_V2}/getLeaderboardRank", body_variants[0]),
    ]

    last_error = "unknown"
    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0), follow_redirects=True) as client:
        for url, body in attempts:
            try:
                resp = await client.post(url, json=body, headers=headers)

                logger.info(
                    f"Leaderboard API attempt: POST {url} "
                    f"period={body.get('periodType')} isShared={body.get('isShared')} "
                    f"→ {resp.status_code}",
                )

                if resp.status_code != 200:
                    last_error = f"HTTP {resp.status_code} from {url}"
                    continue

                data = resp.json()
                raw_preview = resp.text[:500]
                logger.info(f"Leaderboard raw response preview: {raw_preview}")

                if data.get("code") != "000000":
                    last_error = f"API code {data.get('code')}: {data.get('message')}"
                    logger.warning(f"Leaderboard non-zero code: {last_error} | body: {raw_preview}")
                    continue

                raw_list: list[dict] = data.get("data") or []
                if not raw_list:
                    last_error = "empty data array in response"
                    logger.warning(
                        f"Leaderboard empty data — body={raw_preview} | sent={body}"
                    )
                    continue

                leaders = _parse_leaders(raw_list[:limit])
                _leaders_cache[cache_key] = (now, leaders)
                logger.info(
                    f"Copy trading leaders fetched: {len(leaders)} traders "
                    f"(sort={sort_by}, period={period}, variant={body})"
                )
                return leaders

            except httpx.HTTPStatusError as exc:
                body_preview = exc.response.text[:200] if exc.response else ""
                last_error = f"HTTP {exc.response.status_code} from {url}: {body_preview}"
                logger.warning(f"Leaderboard endpoint failed: {last_error}")
            except httpx.ConnectError as exc:
                last_error = f"ConnectError: {exc}"
                logger.warning(f"Leaderboard connect error: {last_error}")
            except httpx.TimeoutException:
                last_error = f"Timeout on {url}"
                logger.warning(f"Leaderboard timeout: {url}")
            except Exception as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                logger.warning(f"Leaderboard unexpected error: {last_error}")

    logger.warning(f"All leaderboard endpoints failed. Last error: {last_error}")
    return []


def _parse_leaders(raw_list: list[dict]) -> list[dict]:
    """Normalise raw Binance leaderboard items into our standard dict format."""
    leaders = []
    for item in raw_list:
        portfolio_id = item.get("portfolioId") or item.get("encryptedUid", "")
        if not portfolio_id:
            continue
        encrypted_uid = item.get("encryptedUid", "")
        if encrypted_uid and portfolio_id:
            _leader_uid_cache[portfolio_id] = encrypted_uid

        # ROI/PnL may come as a decimal (0.1234 = 12.34%) — multiply by 100
        roi_raw = item.get("roi") or item.get("pnlRoi") or 0
        win_raw = item.get("winRate") or 0
        dd_raw = item.get("maxDrawdown") or 0

        leaders.append({
            "portfolio_id": portfolio_id,
            "nick_name": item.get("nickName") or item.get("nickname") or "Unknown",
            "roi": float(roi_raw) * 100,
            "pnl": float(item.get("pnl") or 0),
            "win_rate": float(win_raw) * 100,
            "follower_count": int(item.get("followerCount") or 0),
            "copier_count": int(item.get("copierCount") or 0),
            "position_shared": bool(item.get("positionShared", True)),
            "max_drawdown": float(dd_raw) * 100,
        })
    return leaders


async def get_copy_leader_positions(portfolio_id: str, trading_pair: str) -> dict:
    """
    Fetch a Binance lead trader's current open positions.

    Uses Binance's public leaderboard API (no auth required).
    portfolio_id: hex string from Binance Copy Trading URL
                  e.g. "3953748A4FE10DFA97B2E5A5E4641B82"
    trading_pair: bot's pair in our format e.g. "BTC/USDT:USDT"

    Returns:
      {
        "has_position": bool,   — True if leader holds this pair
        "positions":    list,   — all leader's open positions
        "leader_name":  str | None,
        "error":        str | None,
      }
    """
    now = time.time()

    # Serve from cache if fresh
    cached = _leader_position_cache.get(portfolio_id)
    if cached and (now - cached[0]) < _LEADER_CACHE_TTL_S:
        raw = cached[1]
        has_pos = _pair_in_positions(trading_pair, raw.get("positions", []))
        return {**raw, "has_position": has_pos}

    timeout = httpx.Timeout(10.0)
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # Step 1: resolve portfolioId → encryptedUid (cached)
            encrypted_uid = _leader_uid_cache.get(portfolio_id)
            if not encrypted_uid:
                r1 = await client.get(
                    f"{_BINANCE_LEADERBOARD_BASE}/getLeaderboardRank",
                    params={"portfolioId": portfolio_id, "isTrader": "true"},
                    headers=headers,
                )
                r1.raise_for_status()
                d1 = r1.json()
                if d1.get("code") != "000000" or not d1.get("data"):
                    err = d1.get("message") or f"API code {d1.get('code')}"
                    return {"has_position": False, "positions": [], "leader_name": None, "error": err}
                encrypted_uid = d1["data"].get("encryptedUid") or ""
                leader_name = d1["data"].get("nickName")
                if encrypted_uid:
                    _leader_uid_cache[portfolio_id] = encrypted_uid
            else:
                leader_name = None  # already cached, no name available here

            if not encrypted_uid:
                return {
                    "has_position": False,
                    "positions": [],
                    "leader_name": None,
                    "error": "Could not resolve encryptedUid for portfolioId",
                }

            # Step 2: fetch open positions
            r2 = await client.post(
                f"{_BINANCE_LEADERBOARD_BASE}/getOtherPosition",
                json={"encryptedUid": encrypted_uid, "tradeType": "PERPETUAL"},
                headers=headers,
            )
            r2.raise_for_status()
            d2 = r2.json()
            if d2.get("code") != "000000":
                err = d2.get("message") or f"API code {d2.get('code')}"
                return {"has_position": False, "positions": [], "leader_name": leader_name, "error": err}

            positions = d2.get("data") or []
            result = {
                "has_position": _pair_in_positions(trading_pair, positions),
                "positions": positions,
                "leader_name": leader_name,
                "error": None,
            }
            _leader_position_cache[portfolio_id] = (now, result)
            logger.info(
                "Leader positions fetched",
                extra={
                    "portfolio_id": portfolio_id,
                    "position_count": len(positions),
                    "has_pair": result["has_position"],
                },
            )
            return result

    except httpx.HTTPStatusError as exc:
        err = f"HTTP {exc.response.status_code} from Binance leaderboard API"
        logger.warning("Copy trading leader fetch failed", extra={"error": err})
        return {"has_position": False, "positions": [], "leader_name": None, "error": err}
    except Exception as exc:
        err = str(exc)
        logger.warning("Copy trading leader fetch failed", extra={"error": err})
        return {"has_position": False, "positions": [], "leader_name": None, "error": err}


def _pair_in_positions(trading_pair: str, positions: list[dict]) -> bool:
    """
    Check if any of the leader's open positions match this bot's trading pair.
    Our format: "BTC/USDT:USDT" → Binance leaderboard format: "BTCUSDT"
    """
    # Convert "BTC/USDT:USDT" → "BTCUSDT"
    normalized = trading_pair.replace("/", "").replace(":USDT", "").replace(":usdt", "")
    for pos in positions:
        symbol = str(pos.get("symbol", ""))
        if symbol.upper() == normalized.upper():
            return True
    return False


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
