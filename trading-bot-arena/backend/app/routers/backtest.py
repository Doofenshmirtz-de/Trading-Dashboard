"""Backtest router — runs historical simulations for existing bot strategies."""

import math
import statistics
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.bot_base import Candle
from app.core.bots.bollinger_bot import BollingerBot
from app.core.bots.macd_bot import MACDBot
from app.core.bots.rsi_bot import RSIBot
from app.core.logging import get_logger
from app.core.portfolio_engine import VirtualPortfolioEngine
from app.dependencies import get_current_user
from app.models.market import VALID_TIMEFRAMES
from app.services import binance as binance_service
from app.services.supabase import get_supabase_client

router = APIRouter(prefix="/backtest", tags=["backtest"])
logger = get_logger()

MAX_CANDLES = 3000
MIN_CANDLES = 10

# Annualisation factor per timeframe for Sharpe ratio
_PERIODS_PER_YEAR: dict[str, int] = {
    "1m": 525_600,
    "5m": 105_120,
    "15m": 35_040,
    "1h": 8_760,
    "4h": 2_190,
    "1d": 365,
}


# ── Request / Response Models ──────────────────────────────────────────────────

class BacktestRequest(BaseModel):
    name: str = Field(default="", max_length=100)
    pair: str = Field(..., description="Binance Futures pair, e.g. BTC/USDT:USDT")
    timeframe: str = Field(..., description="Candle timeframe, e.g. 1h")
    from_date: str = Field(..., description="ISO 8601 start date, e.g. 2024-01-01")
    to_date: str = Field(..., description="ISO 8601 end date, e.g. 2024-04-01")
    initial_balance: float = Field(default=10_000.0, gt=0, le=10_000_000)
    config: dict = Field(default_factory=dict)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_bot(config: dict, initial_balance: float):
    """Instantiate the correct bot class from config.indicator."""
    indicator = str(config.get("indicator", "RSI")).upper()
    bot_id = str(uuid.uuid4())
    if indicator == "RSI":
        return RSIBot(bot_id=bot_id, config=config, virtual_balance=initial_balance)
    if indicator == "MACD":
        return MACDBot(bot_id=bot_id, config=config, virtual_balance=initial_balance)
    if indicator in ("BB", "BOLLINGER"):
        return BollingerBot(bot_id=bot_id, config=config, virtual_balance=initial_balance)
    raise HTTPException(
        status_code=422,
        detail=f"Unknown indicator '{indicator}'. Must be RSI, MACD, or BB.",
    )


def _sharpe_ratio(equity: list[float], timeframe: str) -> float:
    """Annualised Sharpe ratio (risk-free rate = 0)."""
    if len(equity) < 3:
        return 0.0
    returns = [
        (equity[i] - equity[i - 1]) / equity[i - 1]
        for i in range(1, len(equity))
        if equity[i - 1] > 0
    ]
    if len(returns) < 2:
        return 0.0
    mean_r = sum(returns) / len(returns)
    try:
        std_r = statistics.stdev(returns)
    except statistics.StatisticsError:
        return 0.0
    if std_r == 0:
        return 0.0
    ppy = _PERIODS_PER_YEAR.get(timeframe, 8_760)
    return round(mean_r / std_r * math.sqrt(ppy), 4)


def _max_drawdown(equity: list[float]) -> float:
    """Maximum peak-to-trough drawdown as a positive percentage."""
    if not equity:
        return 0.0
    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100.0
            if dd > max_dd:
                max_dd = dd
    return round(max_dd, 4)


def _downsample(points: list[dict], max_pts: int = 500) -> list[dict]:
    """Reduce equity curve to at most max_pts evenly-spaced data points."""
    if len(points) <= max_pts:
        return points
    step = (len(points) - 1) / (max_pts - 1)
    return [points[round(i * step)] for i in range(max_pts)]


def _parse_date(date_str: str) -> datetime:
    """Parse ISO 8601 date string, accepting both date and datetime formats."""
    normalised = date_str.strip().replace("Z", "+00:00")
    # Append midnight UTC if only a date was provided
    if "T" not in normalised and " " not in normalised:
        normalised = normalised + "T00:00:00+00:00"
    return datetime.fromisoformat(normalised)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/run")
async def run_backtest(
    req: BacktestRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Run a historical backtest.
    Fetches OHLCV candles from Binance, replays the selected strategy,
    and returns performance metrics + equity curve + trade log.
    """
    if req.timeframe not in VALID_TIMEFRAMES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid timeframe '{req.timeframe}'. Must be one of {list(VALID_TIMEFRAMES)}",
        )

    try:
        from_dt = _parse_date(req.from_date)
        to_dt = _parse_date(req.to_date)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail="Invalid date format. Use ISO 8601 (e.g. 2024-01-01 or 2024-01-01T00:00:00Z)",
        )

    if from_dt >= to_dt:
        raise HTTPException(status_code=422, detail="from_date must be before to_date")

    from_ms = int(from_dt.timestamp() * 1000)
    to_ms = int(to_dt.timestamp() * 1000)

    logger.info(
        "Backtest started",
        extra={
            "pair": req.pair,
            "timeframe": req.timeframe,
            "from": req.from_date,
            "to": req.to_date,
            "user_id": current_user["user_id"],
        },
    )

    try:
        raw_candles = await binance_service.get_historical_candles(
            symbol=req.pair,
            timeframe=req.timeframe,
            since_ms=from_ms,
            until_ms=to_ms,
            max_candles=MAX_CANDLES,
        )
    except Exception as exc:
        logger.error("Candle fetch failed for backtest", extra={"error": str(exc)})
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch historical data from Binance: {exc}",
        )

    if len(raw_candles) < MIN_CANDLES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Only {len(raw_candles)} candles returned for this date range. "
                "Try a wider range or a different timeframe."
            ),
        )

    bot = _make_bot(req.config, req.initial_balance)
    engine = VirtualPortfolioEngine(
        bot_id=bot.bot_id,
        initial_balance=req.initial_balance,
    )
    user_id = current_user["user_id"]

    equity_curve_raw: list[dict] = []
    trade_log: list[dict] = []

    for raw in raw_candles:
        candle = Candle(
            timestamp=raw["timestamp"],
            open=raw["open"],
            high=raw["high"],
            low=raw["low"],
            close=raw["close"],
            volume=raw["volume"],
        )

        signal = bot.on_candle(candle)

        if signal is not None:
            trade = engine.execute(signal, candle, user_id)
            if trade:
                trade_log.append({
                    "action": trade["action"],
                    "price": round(trade["price"], 6),
                    "timestamp": candle.timestamp,
                    "pnl_usdt": trade.get("pnl_usdt"),
                    "pnl_pct": trade.get("pnl_pct"),
                    "reason": trade.get("signal_reason", ""),
                })

        total_value = engine.get_total_value(candle.close)
        equity_curve_raw.append({"timestamp": candle.timestamp, "value": round(total_value, 4)})

    equity_values = [p["value"] for p in equity_curve_raw]
    final_balance = equity_values[-1] if equity_values else req.initial_balance
    pnl_usdt = final_balance - req.initial_balance
    pnl_pct = (pnl_usdt / req.initial_balance * 100.0) if req.initial_balance > 0 else 0.0

    sell_trades = [t for t in trade_log if t["action"] == "sell"]
    winning = [t for t in sell_trades if (t.get("pnl_pct") or 0) > 0]

    metrics = {
        "total_trades": len(sell_trades),
        "winning_trades": len(winning),
        "losing_trades": len(sell_trades) - len(winning),
        "win_rate": round(len(winning) / len(sell_trades), 4) if sell_trades else 0.0,
        "pnl_usdt": round(pnl_usdt, 4),
        "pnl_pct": round(pnl_pct, 4),
        "max_drawdown_pct": _max_drawdown(equity_values),
        "sharpe_ratio": _sharpe_ratio(equity_values, req.timeframe),
        "final_balance": round(final_balance, 4),
    }

    equity_curve = _downsample(equity_curve_raw, 500)
    trades_truncated = trade_log[-200:]

    backtest_id = str(uuid.uuid4())
    indicator = str(req.config.get("indicator", "Bot")).upper()
    name = req.name.strip() or f"{indicator} {req.pair} {req.timeframe}"

    result = {
        "id": backtest_id,
        "name": name,
        "pair": req.pair,
        "timeframe": req.timeframe,
        "from_date": req.from_date,
        "to_date": req.to_date,
        "initial_balance": req.initial_balance,
        "config": req.config,
        "metrics": metrics,
        "equity_curve": equity_curve,
        "trades": trades_truncated,
        "candle_count": len(raw_candles),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        client = get_supabase_client()
        client.table("backtest_runs").insert({
            "id": backtest_id,
            "user_id": user_id,
            "name": name,
            "pair": req.pair,
            "timeframe": req.timeframe,
            "from_date": req.from_date,
            "to_date": req.to_date,
            "initial_balance": req.initial_balance,
            "config": req.config,
            "result": {
                "metrics": metrics,
                "equity_curve": equity_curve,
                "trades": trades_truncated,
            },
            "total_trades": metrics["total_trades"],
            "win_rate": metrics["win_rate"],
            "pnl_pct": metrics["pnl_pct"],
            "max_drawdown_pct": metrics["max_drawdown_pct"],
            "sharpe_ratio": metrics["sharpe_ratio"],
            "candle_count": len(raw_candles),
            "status": "completed",
        }).execute()
    except Exception as exc:
        logger.error("Failed to persist backtest result", extra={"error": str(exc)})

    logger.info(
        "Backtest completed",
        extra={
            "pair": req.pair,
            "timeframe": req.timeframe,
            "candles": len(raw_candles),
            "trades": metrics["total_trades"],
            "pnl_pct": metrics["pnl_pct"],
        },
    )

    return result


@router.get("/results")
async def list_backtest_results(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """List past backtest runs for the current user (no equity curve / trades)."""
    client = get_supabase_client()
    resp = (
        client.table("backtest_runs")
        .select(
            "id, name, pair, timeframe, from_date, to_date, initial_balance, "
            "config, total_trades, win_rate, pnl_pct, max_drawdown_pct, "
            "sharpe_ratio, candle_count, status, created_at"
        )
        .eq("user_id", current_user["user_id"])
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {"results": resp.data or [], "total": len(resp.data or [])}


@router.get("/results/{backtest_id}")
async def get_backtest_result(
    backtest_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Get a full backtest result including equity curve and trade log."""
    client = get_supabase_client()
    resp = (
        client.table("backtest_runs")
        .select("*")
        .eq("id", backtest_id)
        .eq("user_id", current_user["user_id"])
        .single()
        .execute()
    )
    if not resp.data:
        raise HTTPException(status_code=404, detail="Backtest not found")

    row = resp.data
    result_data: dict = row.get("result") or {}

    return {
        "id": str(row["id"]),
        "name": row.get("name", ""),
        "pair": row["pair"],
        "timeframe": row["timeframe"],
        "from_date": row.get("from_date", ""),
        "to_date": row.get("to_date", ""),
        "initial_balance": float(row["initial_balance"]),
        "config": row.get("config") or {},
        "metrics": result_data.get("metrics") or {},
        "equity_curve": result_data.get("equity_curve") or [],
        "trades": result_data.get("trades") or [],
        "candle_count": row.get("candle_count") or 0,
        "created_at": str(row["created_at"]),
    }


@router.delete("/results/{backtest_id}", status_code=204)
async def delete_backtest_result(
    backtest_id: str,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Delete a backtest run owned by the current user."""
    client = get_supabase_client()
    client.table("backtest_runs").delete().eq("id", backtest_id).eq(
        "user_id", current_user["user_id"]
    ).execute()
