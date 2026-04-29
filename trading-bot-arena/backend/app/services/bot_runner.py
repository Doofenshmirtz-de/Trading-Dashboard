"""
BotRunner — manages all in-memory bot instances and drives the tick loop.

Design:
  - One BotRunner singleton (bot_runner) shared across the app
  - One APScheduler job per timeframe (1m/5m/15m/1h/4h/1d)
  - tick_timeframe(tf) only processes bots configured for that timeframe
  - Position state is reconstructed from bot_trades on startup

# TODO Phase 4: Replace with Celery + Redis workers
#   - Railway free tier may pause container → APScheduler jobs stop
#   - Multiple Railway instances = duplicate ticks (no distributed lock)
#   - max_instances=1 prevents overlap on a single instance only
# TODO Phase 4: Persist RSI price history to Supabase on stop
#   - Currently warm-up re-fetches history on every restart
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import jsonschema

from app.core.bot_base import Candle
from app.core.bots.rsi_bot import RSIBot
from app.core.portfolio_engine import VirtualPortfolioEngine
from app.services.binance import get_candles
from app.services.supabase import get_supabase_client

logger = logging.getLogger("trading_bot_arena")

TIMEFRAME_SECONDS: dict[str, int] = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14400,
    "1d": 86400,
}


def _make_bot(bot_type: str, bot_id: str, config: dict, virtual_balance: float):
    """Instantiate the correct bot class from the bot_record type string."""
    if bot_type == "rule_based":
        return RSIBot(bot_id, config, virtual_balance)
    # TODO Phase 4: Add copy_trading, ml, custom bot types
    raise ValueError(f"Unsupported bot type for sandbox execution: {bot_type!r}")


def _row_to_candle(row: list) -> Candle:
    """Convert ccxt OHLCV list [ts, o, h, l, c, v] to Candle dataclass."""
    return Candle(
        timestamp=int(row[0]),
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
    )


class BotRunner:
    """
    Central coordinator for all running bot instances.

    self.running structure per bot_id:
      {
        "bot":             RSIBot instance,
        "engine":          VirtualPortfolioEngine instance,
        "config":          dict (raw bot config from Supabase),
        "user_id":         str,
        "name":            str,
        "pair":            str  (e.g. "BTC/USDT:USDT"),
        "timeframe":       str  (e.g. "1h"),
        "initial_balance": float,
      }
    """

    def __init__(self) -> None:
        self.running: dict[str, dict] = {}

    # ── Bot lifecycle ──────────────────────────────────────────────────────────

    async def start_bot(self, bot_record: dict) -> None:
        bot_id = str(bot_record["id"])
        bot_type = bot_record["type"]
        config = bot_record.get("config") or {}
        user_id = str(bot_record["user_id"])
        name = bot_record["name"]
        pair = bot_record.get("trading_pair", "BTC/USDT:USDT")
        initial_balance = float(bot_record.get("initial_balance", 10000))
        virtual_balance = float(bot_record.get("virtual_balance", initial_balance))

        # Instantiate the bot to get its schema
        try:
            bot = _make_bot(bot_type, bot_id, config, virtual_balance)
        except ValueError as e:
            logger.warning("start_bot skipped: unsupported type", extra={"bot_id": bot_id, "error": str(e)})
            return

        # Validate config against the bot's schema
        schema = bot.get_config_schema()
        try:
            jsonschema.validate(config, schema)
        except jsonschema.ValidationError as e:
            logger.error(
                "start_bot skipped: invalid config",
                extra={"bot_id": bot_id, "name": name, "error": e.message},
            )
            return

        timeframe = str(config.get("timeframe", "1h"))
        position_size_pct = float(config.get("position_size_pct", 95.0))

        engine = VirtualPortfolioEngine(
            bot_id=bot_id,
            initial_balance=initial_balance,
            position_size_pct=position_size_pct,
        )
        # Sync balance to whatever is stored in DB (may differ after previous trades)
        engine.balance = virtual_balance

        # Reconstruct open position from trade history
        await self._reconstruct_position(bot_id, engine, initial_balance)

        # Warm up RSI with historical candles (feed without executing trades)
        period = int(config.get("period", 14))
        warmup_count = period + 2  # one extra for safety
        try:
            raw_candles = await get_candles(pair, timeframe, warmup_count)
            for row in raw_candles:
                candle = _row_to_candle(row)
                bot.on_candle(candle)
            logger.info(
                "Bot warm-up complete",
                extra={"bot_id": bot_id, "name": name, "candles": len(raw_candles)},
            )
        except Exception as e:
            logger.warning(
                "Bot warm-up failed (will start cold)",
                extra={"bot_id": bot_id, "error": str(e)},
            )

        self.running[bot_id] = {
            "bot": bot,
            "engine": engine,
            "config": config,
            "user_id": user_id,
            "name": name,
            "pair": pair,
            "timeframe": timeframe,
            "initial_balance": initial_balance,
        }
        logger.info("Bot started", extra={"bot_id": bot_id, "name": name, "type": bot_type})

    async def stop_bot(self, bot_id: str) -> None:
        if bot_id in self.running:
            name = self.running[bot_id].get("name", bot_id)
            del self.running[bot_id]
            logger.info("Bot stopped", extra={"bot_id": bot_id, "name": name})

    async def load_running_bots(self) -> None:
        """Called at app startup — re-instantiate all bots with status='running'."""
        client = get_supabase_client()
        resp = client.table("bots").select("*").eq("status", "running").execute()
        bots = resp.data or []
        logger.info("Loading running bots on startup", extra={"count": len(bots)})
        for record in bots:
            try:
                await self.start_bot(record)
            except Exception as e:
                logger.error(
                    "Failed to load bot on startup",
                    extra={"bot_id": str(record.get("id")), "error": str(e)},
                )
        logger.info("Bot runner ready", extra={"active": len(self.running)})

    # ── Tick ───────────────────────────────────────────────────────────────────

    async def tick_timeframe(self, tf: str) -> None:
        """
        Process one tick for all bots configured with the given timeframe.
        Called by APScheduler on the matching interval.
        """
        bots_for_tf = {
            bid: entry
            for bid, entry in self.running.items()
            if entry["timeframe"] == tf
        }

        if not bots_for_tf:
            return

        logger.info("Tick started", extra={"timeframe": tf, "bot_count": len(bots_for_tf)})

        for bot_id, entry in bots_for_tf.items():
            try:
                await self._tick_bot(bot_id, entry)
            except Exception as e:
                logger.error(
                    "Bot tick error",
                    extra={"bot_id": bot_id, "name": entry.get("name"), "error": str(e)},
                )

    async def _tick_bot(self, bot_id: str, entry: dict) -> None:
        bot = entry["bot"]
        engine = entry["engine"]
        user_id = entry["user_id"]
        pair = entry["pair"]
        timeframe = entry["timeframe"]
        name = entry["name"]
        initial_balance = entry["initial_balance"]

        # Fetch 2 candles; use candles[-2] = last fully closed candle
        raw = await get_candles(pair, timeframe, 2)
        if len(raw) < 2:
            logger.warning("Not enough candles returned", extra={"bot_id": bot_id, "pair": pair})
            return

        candle = _row_to_candle(raw[-2])
        current_price = float(raw[-1][4])  # latest close for snapshot

        # Feed candle to bot
        signal = bot.on_candle(candle)

        rsi_value: float | None = None
        if hasattr(bot, "last_rsi"):
            rsi_value = bot.last_rsi  # type: ignore[attr-defined]

        # Save signal (always, even hold)
        if signal is not None:
            await self._save_signal(bot_id, signal, candle, rsi_value)

            if signal.action in ("buy", "sell"):
                trade = engine.execute(signal, candle, user_id)
                if trade:
                    await self._save_trade(trade)
                    # Update virtual_balance in bots table
                    await self._update_balance(bot_id, user_id, engine.balance)

        # Save performance snapshot
        await self._save_snapshot(bot_id, engine, initial_balance, current_price)

        action = signal.action if signal else "none"
        logger.info(
            f"Tick [{timeframe}]: {name} | RSI={rsi_value:.1f if rsi_value is not None else 'n/a'} | "
            f"Signal={action} | Balance={engine.balance:.2f}"
        )

    # ── DB helpers ─────────────────────────────────────────────────────────────

    async def _reconstruct_position(
        self, bot_id: str, engine: VirtualPortfolioEngine, initial_balance: float
    ) -> None:
        """Query bot_trades ordered by created_at ASC and replay into engine."""
        client = get_supabase_client()
        resp = (
            client.table("bot_trades")
            .select("*")
            .eq("bot_id", bot_id)
            .order("created_at", desc=False)
            .execute()
        )
        trades = resp.data or []
        if trades:
            # Reset balance to initial before replaying
            engine.balance = initial_balance
            engine.reconstruct_from_trades(trades)
            logger.info(
                "Position reconstructed",
                extra={
                    "bot_id": bot_id,
                    "trades": len(trades),
                    "has_position": engine.position is not None,
                },
            )

    async def _save_signal(
        self, bot_id: str, signal, candle: Candle, rsi_value: float | None
    ) -> None:
        client = get_supabase_client()
        client.table("bot_signals").insert({
            "bot_id": bot_id,
            "timestamp": datetime.fromtimestamp(candle.timestamp / 1000, tz=timezone.utc).isoformat(),
            "action": signal.action,
            "confidence": signal.confidence,
            "reason": signal.reason,
            "candle_close": candle.close,
            "rsi_value": rsi_value,
        }).execute()

    async def _save_trade(self, trade: dict) -> None:
        client = get_supabase_client()
        client.table("bot_trades").insert(trade).execute()

    async def _update_balance(self, bot_id: str, user_id: str, balance: float) -> None:
        client = get_supabase_client()
        client.table("bots").update({"virtual_balance": balance}).eq("id", bot_id).eq("user_id", user_id).execute()

    async def _save_snapshot(
        self,
        bot_id: str,
        engine: VirtualPortfolioEngine,
        initial_balance: float,
        current_price: float,
    ) -> None:
        pos_value = engine.get_position_value(current_price)
        total_value = engine.get_total_value(current_price)
        pnl_pct = engine.get_pnl_pct(initial_balance, current_price)

        client = get_supabase_client()
        client.table("bot_snapshots").insert({
            "bot_id": bot_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "virtual_balance": engine.balance,
            "position_value": pos_value,
            "total_value": total_value,
            "pnl_pct": round(pnl_pct, 4),
            "btc_price": current_price,
        }).execute()


# Singleton instance shared across the app
bot_runner = BotRunner()
