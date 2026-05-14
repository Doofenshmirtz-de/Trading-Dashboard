import math
import re
import statistics
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from postgrest.exceptions import APIError
from app.dependencies import get_current_user
from app.services.supabase import get_supabase_client
from app.services.bot_runner import bot_runner
from app.models.bot import (
    CreateBotRequest,
    UpdateBotRequest,
    BotResponse,
    validate_transition,
    validate_bot_config,
)
from app.core.exceptions import BotNotFoundError, InvalidBotTransitionError
from app.core.logging import get_logger
from app.services.regime_service import MarketRegime

router = APIRouter(prefix="/bots", tags=["bots"])
logger = get_logger()

TRADING_PAIR_REGEX = re.compile(r"^[A-Z]+/USDT:USDT$")

# Downsampling bucket sizes in seconds for /snapshots resolution param
_RESOLUTION_SECONDS: dict[str, int] = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _row_to_response(row: dict) -> BotResponse:
    return BotResponse(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        name=row["name"],
        type=row["type"],
        status=row["status"],
        config=row.get("config") or {},
        virtual_balance=float(row["virtual_balance"]),
        initial_balance=float(row["initial_balance"]),
        trading_pair=row["trading_pair"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
        started_at=row.get("started_at"),
    )


def _is_missing_started_at_error(exc: APIError) -> bool:
    text = str(exc)
    return "PGRST204" in text and "started_at" in text and "bots" in text


def _get_bot_or_404(bot_id: str, user_id: str) -> dict:
    client = get_supabase_client()
    resp = (
        client.table("bots")
        .select("*")
        .eq("id", bot_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise BotNotFoundError(bot_id)
    return resp.data  # type: ignore[return-value]


# ── CRUD endpoints ────────────────────────────────────────────────────────────

@router.get("")
def list_bots(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
) -> dict:
    # TODO Phase 3: Replace with cursor-based pagination
    client = get_supabase_client()
    user_id = current_user["user_id"]

    count_resp = (
        client.table("bots")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    total = count_resp.count or 0

    data_resp = (
        client.table("bots")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    bots = [_row_to_response(row).model_dump() for row in (data_resp.data or [])]
    logger.info("Bots listed", extra={"user_id": user_id, "count": len(bots)})
    return {"bots": bots, "total": total, "limit": limit, "offset": offset}


@router.post("", status_code=201)
def create_bot(
    body: CreateBotRequest,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    user_id = current_user["user_id"]

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Bot name cannot be empty")

    if not TRADING_PAIR_REGEX.match(body.trading_pair):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid trading_pair '{body.trading_pair}'. "
            "Must match pattern like BTC/USDT:USDT",
        )

    try:
        validate_bot_config(body.type, body.config)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    client = get_supabase_client()
    insert_data = {
        "user_id": user_id,
        "name": name,
        "type": body.type,
        "status": "stopped",
        "config": body.config,
        "virtual_balance": body.virtual_balance,
        "initial_balance": body.initial_balance,
        "trading_pair": body.trading_pair,
    }

    resp = client.table("bots").insert(insert_data).execute()
    if not resp.data:
        logger.error(
            "Bot insert returned no data",
            extra={"user_id": user_id, "insert_data": insert_data},
        )
        raise HTTPException(status_code=500, detail="Bot creation failed — Supabase returned no data")
    row = resp.data[0]

    logger.info(
        "Bot created",
        extra={"user_id": user_id, "bot_id": row["id"], "bot_type": body.type},
    )
    return _row_to_response(row)


@router.get("/{bot_id}")
def get_bot(
    bot_id: str,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    row = _get_bot_or_404(bot_id, current_user["user_id"])
    return _row_to_response(row)


@router.patch("/{bot_id}")
async def update_bot(
    bot_id: str,
    body: UpdateBotRequest,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    user_id = current_user["user_id"]
    current_row = _get_bot_or_404(bot_id, user_id)

    if body.status is not None:
        try:
            validate_transition(current_row["status"], body.status)
        except InvalidBotTransitionError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        logger.info(
            "Bot status transition",
            extra={
                "user_id": user_id,
                "bot_id": bot_id,
                "from": current_row["status"],
                "to": body.status,
            },
        )

    if body.trading_pair is not None and not TRADING_PAIR_REGEX.match(body.trading_pair):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid trading_pair '{body.trading_pair}'",
        )

    update_data: dict = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.name is not None:
        stripped = body.name.strip()
        if not stripped:
            raise HTTPException(status_code=422, detail="Bot name cannot be empty")
        update_data["name"] = stripped
    if body.status is not None:
        update_data["status"] = body.status
        # Update started_at based on status transition
        if body.status == "running":
            update_data["started_at"] = datetime.now(timezone.utc).isoformat()
        elif body.status in ("stopped", "paused"):
            update_data["started_at"] = None
    if body.config is not None:
        update_data["config"] = body.config
    if body.trading_pair is not None:
        update_data["trading_pair"] = body.trading_pair
    if body.virtual_balance is not None:
        update_data["virtual_balance"] = body.virtual_balance

    client = get_supabase_client()
    try:
        resp = (
            client.table("bots")
            .update(update_data)
            .eq("id", bot_id)
            .eq("user_id", user_id)
            .execute()
        )
    except APIError as e:
        # Supabase schema cache may lag behind migrations; retry without started_at.
        if "started_at" in update_data and _is_missing_started_at_error(e):
            logger.warning(
                "started_at column missing in schema cache, retrying update without started_at",
                extra={"bot_id": bot_id, "user_id": user_id},
            )
            fallback_update_data = {k: v for k, v in update_data.items() if k != "started_at"}
            resp = (
                client.table("bots")
                .update(fallback_update_data)
                .eq("id", bot_id)
                .eq("user_id", user_id)
                .execute()
            )
        else:
            raise
    updated_row = resp.data[0]

    # Hook into BotRunner on status transitions — non-critical; never fail the HTTP response
    if body.status == "running":
        try:
            await bot_runner.start_bot(updated_row)
        except Exception as e:
            logger.error(
                "BotRunner.start_bot failed",
                extra={"bot_id": bot_id, "error": str(e)},
            )
    elif body.status in ("stopped", "paused"):
        try:
            await bot_runner.stop_bot(bot_id)
        except Exception as e:
            logger.error(
                "BotRunner.stop_bot failed",
                extra={"bot_id": bot_id, "error": str(e)},
            )

    return _row_to_response(updated_row)


@router.delete("/{bot_id}")
async def delete_bot(
    bot_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = current_user["user_id"]
    _get_bot_or_404(bot_id, user_id)

    # Stop bot runner before deleting
    await bot_runner.stop_bot(bot_id)

    client = get_supabase_client()
    client.table("bots").delete().eq("id", bot_id).eq("user_id", user_id).execute()

    logger.info("Bot deleted", extra={"user_id": user_id, "bot_id": bot_id})
    return {"deleted": True}


# ── Analytics endpoints ───────────────────────────────────────────────────────

@router.get("/{bot_id}/trades")
async def get_bot_trades(
    bot_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
) -> dict:
    _get_bot_or_404(bot_id, current_user["user_id"])
    client = get_supabase_client()

    count_resp = (
        client.table("bot_trades")
        .select("id", count="exact")
        .eq("bot_id", bot_id)
        .execute()
    )
    total = count_resp.count or 0

    data_resp = (
        client.table("bot_trades")
        .select("*")
        .eq("bot_id", bot_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"trades": data_resp.data or [], "total": total}


@router.get("/{bot_id}/signals")
async def get_bot_signals(
    bot_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
) -> dict:
    _get_bot_or_404(bot_id, current_user["user_id"])
    client = get_supabase_client()

    count_resp = (
        client.table("bot_signals")
        .select("id", count="exact")
        .eq("bot_id", bot_id)
        .execute()
    )
    total = count_resp.count or 0

    data_resp = (
        client.table("bot_signals")
        .select("*")
        .eq("bot_id", bot_id)
        .order("timestamp", desc=True)
        .limit(limit)
        .execute()
    )
    return {"signals": data_resp.data or [], "total": total}


@router.get("/{bot_id}/snapshots")
async def get_bot_snapshots(
    bot_id: str,
    limit: int = Query(default=720, ge=1, le=5000),
    resolution: str = Query(default="1h"),
    current_user: dict = Depends(get_current_user),
) -> dict:
    bot_row = _get_bot_or_404(bot_id, current_user["user_id"])

    if resolution not in _RESOLUTION_SECONDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid resolution '{resolution}'. "
            f"Must be one of: {list(_RESOLUTION_SECONDS.keys())}",
        )

    client = get_supabase_client()
    # Fetch more than limit to allow downsampling
    fetch_limit = min(limit * 10, 5000)
    data_resp = (
        client.table("bot_snapshots")
        .select("*")
        .eq("bot_id", bot_id)
        .order("timestamp", desc=False)
        .limit(fetch_limit)
        .execute()
    )
    all_snapshots = data_resp.data or []

    # Parse + sanitize snapshots first (protect charts from legacy corrupted points).
    parsed_snapshots: list[dict] = []
    for snap in all_snapshots:
        try:
            ts = datetime.fromisoformat(snap["timestamp"].replace("Z", "+00:00"))
            pnl_pct = float(snap.get("pnl_pct") or 0.0)
            # Ignore clearly corrupted historical points that can distort multi-timeframe charts.
            if abs(pnl_pct) > 250:
                continue
            snap_copy = dict(snap)
            snap_copy["_epoch"] = int(ts.timestamp())
            parsed_snapshots.append(snap_copy)
        except (ValueError, KeyError, TypeError):
            continue

    if not parsed_snapshots:
        return {"snapshots": [], "bot": _row_to_response(bot_row).model_dump()}

    # Restrict to the requested rolling time window, not just last N rows.
    # This fixes 1D/1M/ALL showing very old points when bots don't produce dense snapshots.
    bucket_seconds = _RESOLUTION_SECONDS[resolution]
    latest_epoch = parsed_snapshots[-1]["_epoch"]
    cutoff_epoch = latest_epoch - (limit * bucket_seconds)
    windowed_snapshots = [s for s in parsed_snapshots if s["_epoch"] >= cutoff_epoch]
    if not windowed_snapshots:
        windowed_snapshots = parsed_snapshots[-limit:]

    # Downsample: keep last snapshot per resolution bucket
    buckets: dict[int, dict] = {}
    for snap in windowed_snapshots:
        bucket = int(snap["_epoch"] // bucket_seconds) * bucket_seconds
        buckets[bucket] = snap  # later snap overwrites earlier in same bucket

    downsampled = sorted(buckets.values(), key=lambda s: s["timestamp"])[-limit:]
    for snap in downsampled:
        snap.pop("_epoch", None)
    return {"snapshots": downsampled, "bot": _row_to_response(bot_row).model_dump()}


@router.get("/{bot_id}/performance")
async def get_bot_performance(
    bot_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    bot_row = _get_bot_or_404(bot_id, current_user["user_id"])
    client = get_supabase_client()

    # All closed trades (sells have pnl set)
    trades_resp = (
        client.table("bot_trades")
        .select("*")
        .eq("bot_id", bot_id)
        .order("created_at", desc=False)
        .execute()
    )
    trades = trades_resp.data or []

    closed_trades = [t for t in trades if t.get("pnl_pct") is not None]
    pnl_values = [float(t["pnl_pct"]) for t in closed_trades]
    pnl_usdt_values = [float(t["pnl_usdt"]) for t in closed_trades if t.get("pnl_usdt") is not None]
    winning = [p for p in pnl_values if p > 0]
    losing = [p for p in pnl_values if p <= 0]

    # Snapshots for Sharpe, drawdown, and PnL
    snaps_resp = (
        client.table("bot_snapshots")
        .select("total_value,pnl_pct,timestamp")
        .eq("bot_id", bot_id)
        .order("timestamp", desc=False)
        .execute()
    )
    snapshots = snaps_resp.data or []

    # Use latest snapshot's pnl_pct as total_pnl_pct for consistency with Equity Curve
    # This fixes the discrepancy between Performance Card and Equity Curve
    latest_pnl_pct = 0.0
    if snapshots:
        latest_pnl_pct = float(snapshots[-1]["pnl_pct"])

    # Max drawdown from total_value series
    max_drawdown = 0.0
    peak = 0.0
    for s in snapshots:
        tv = float(s["total_value"])
        if tv > peak:
            peak = tv
        if peak > 0:
            dd = (peak - tv) / peak * 100.0
            if dd > max_drawdown:
                max_drawdown = dd

    # Sharpe ratio (annualised from hourly snapshots)
    sharpe = 0.0
    if len(snapshots) >= 2:
        snap_pnls = [float(s["pnl_pct"]) for s in snapshots]
        returns = [snap_pnls[i] - snap_pnls[i - 1] for i in range(1, len(snap_pnls))]
        if len(returns) >= 2:
            mean_r = statistics.mean(returns)
            std_r = statistics.stdev(returns)
            if std_r > 0:
                sharpe = round((mean_r / std_r) * math.sqrt(365 * 24), 4)

    # days_running: use started_at if available, else fall back to first trade or updated_at
    days_running = 0.0
    if bot_row.get("started_at"):
        started_at = datetime.fromisoformat(str(bot_row["started_at"]).replace("Z", "+00:00"))
        days_running = (datetime.now(timezone.utc) - started_at).total_seconds() / 86400
    elif trades:
        first_trade_at = datetime.fromisoformat(trades[0]["created_at"].replace("Z", "+00:00"))
        days_running = (datetime.now(timezone.utc) - first_trade_at).total_seconds() / 86400
    elif bot_row.get("updated_at"):
        updated_at = datetime.fromisoformat(str(bot_row["updated_at"]).replace("Z", "+00:00"))
        days_running = (datetime.now(timezone.utc) - updated_at).total_seconds() / 86400

    # Current open position from the running engine (if bot is active)
    current_position: dict | None = None
    if bot_id in bot_runner.running:
        current_position = bot_runner.running[bot_id]["engine"].position

    return {
        "total_trades": len(closed_trades),
        "winning_trades": len(winning),
        "losing_trades": len(losing),
        "win_rate": round(len(winning) / len(closed_trades), 4) if closed_trades else 0.0,
        "total_pnl_usdt": round(sum(pnl_usdt_values), 4),
        "total_pnl_pct": round(latest_pnl_pct, 4),  # Use snapshot pnl_pct for consistency
        "best_trade_pct": round(max(pnl_values), 4) if pnl_values else 0.0,
        "worst_trade_pct": round(min(pnl_values), 4) if pnl_values else 0.0,
        "avg_trade_pct": round(statistics.mean(pnl_values), 4) if pnl_values else 0.0,
        "max_drawdown_pct": round(max_drawdown, 4),
        "sharpe_ratio": sharpe,
        "current_position": current_position,
        "days_running": round(days_running, 2),
    }


# ── Comparison endpoint ───────────────────────────────────────────────────────

@router.get("/comparison/all")
async def get_bots_comparison(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Get all bots with their performance data for comparison.
    
    Returns combined data in a single request:
    - All bots for current user
    - Performance metrics for each bot
    - Latest snapshot for each bot
    - Current market regime
    """
    import asyncio
    from app.services.regime_service import regime_service, MarketRegime
    
    user_id = current_user["user_id"]
    client = get_supabase_client()
    
    # Fetch all bots for user
    bots_resp = (
        client.table("bots")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    bots = bots_resp.data or []
    
    if not bots:
        # Return empty result with regime
        regime_result = await regime_service.detect_regime("BTC/USDT:USDT", "1h")
        return {
            "bots": [],
            "regime": {
                "regime": regime_result.regime.value,
                "indicators": {
                    "adx": regime_result.adx,
                    "bb_width_pct": regime_result.bb_width_pct,
                    "sma_slope": regime_result.sma_slope,
                    "plus_di": regime_result.plus_di,
                    "minus_di": regime_result.minus_di,
                },
            },
        }
    
    # Helper to fetch performance for a single bot
    async def fetch_bot_performance_data(bot: dict) -> dict:
        bot_id = bot["id"]
        
        # Fetch trades, snapshots, and signals in parallel
        trades_future = asyncio.to_thread(
            lambda: client.table("bot_trades")
            .select("*")
            .eq("bot_id", bot_id)
            .execute()
        )
        
        snapshots_future = asyncio.to_thread(
            lambda: client.table("bot_snapshots")
            .select("*")
            .eq("bot_id", bot_id)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
        )
        
        trades_result, snapshots_result = await asyncio.gather(
            trades_future, snapshots_future
        )
        
        trades = trades_result.data or []
        snapshots = snapshots_result.data or []
        latest_snapshot = snapshots[0] if snapshots else None
        
        # Calculate performance metrics
        closed_trades = [t for t in trades if t.get("pnl_pct") is not None]
        pnl_values = [float(t["pnl_pct"]) for t in closed_trades]
        winning = [p for p in pnl_values if p > 0]
        
        # Determine indicator type for regime fit
        config = bot.get("config") or {}
        indicator = config.get("indicator", "RSI")
        
        # Calculate simple regime fit score
        # This will be populated after we get the regime
        
        return {
            "bot": _row_to_response(bot).model_dump(),
            "performance": {
                "total_trades": len(closed_trades),
                "winning_trades": len(winning),
                "losing_trades": len(closed_trades) - len(winning),
                "win_rate": round(len(winning) / len(closed_trades), 4) if closed_trades else 0.0,
                "total_pnl_pct": round(sum(pnl_values), 4) if pnl_values else 0.0,
                "indicator": indicator,
            },
            "latest_snapshot": latest_snapshot,
            "indicator": indicator,
        }
    
    # Fetch regime and bot data in parallel
    regime_future = regime_service.detect_regime("BTC/USDT:USDT", "1h")
    bot_data_future = asyncio.gather(*[fetch_bot_performance_data(bot) for bot in bots])
    
    regime_result, bot_data_list = await asyncio.gather(regime_future, bot_data_future)
    
    # Calculate regime fit for each bot
    for bot_data in bot_data_list:
        indicator = bot_data["indicator"]
        fit_score = regime_service.get_regime_fit_score(regime_result.regime, indicator)
        
        # Determine fit label
        if fit_score >= 70:
            fit_label = "Passt"
            fit_emoji = "✅"
        elif fit_score >= 50:
            fit_label = "Neutral"
            fit_emoji = "➖"
        else:
            fit_label = "Suboptimal"
            fit_emoji = "⚠️"
        
        bot_data["regime_fit"] = {
            "score": fit_score,
            "label": fit_label,
            "emoji": fit_emoji,
        }
        # Remove temporary indicator field
        del bot_data["indicator"]
    
    return {
        "bots": bot_data_list,
        "regime": {
            "regime": regime_result.regime.value,
            "description": _get_regime_description(regime_result.regime),
            "recommendation": _get_regime_recommendation(regime_result.regime),
            "indicators": {
                "adx": regime_result.adx,
                "bb_width_pct": regime_result.bb_width_pct,
                "sma_slope": regime_result.sma_slope,
                "plus_di": regime_result.plus_di,
                "minus_di": regime_result.minus_di,
            },
        },
    }


def _get_regime_description(regime: MarketRegime) -> str:
    descriptions = {
        MarketRegime.TRENDING_UP: "Klarer Aufwärtstrend",
        MarketRegime.TRENDING_DOWN: "Klarer Abwärtstrend",
        MarketRegime.RANGING: "Seitwärtsphase (Ranging)",
        MarketRegime.HIGH_VOLATILITY: "Hohe Volatilität",
        MarketRegime.UNKNOWN: "Keine Daten verfügbar",
    }
    return descriptions.get(regime, "Unbekannt")


def _get_regime_recommendation(regime: MarketRegime) -> str:
    recommendations = {
        MarketRegime.TRENDING_UP: "MACD und Momentum-Bots bevorzugen",
        MarketRegime.TRENDING_DOWN: "Short-Strategien oder Cash bevorzugen",
        MarketRegime.RANGING: "Bollinger Bands und Mean-Reversion bevorzugen",
        MarketRegime.HIGH_VOLATILITY: "Konservative Einstellungen, kleinere Positionen",
        MarketRegime.UNKNOWN: "Warten auf Marktdaten",
    }
    return recommendations.get(regime, "")
