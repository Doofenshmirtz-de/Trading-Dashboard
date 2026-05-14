"""
Copy Trading Bot — mirrors a Binance Lead Trader's positions with risk controls.

Strategy:
  - BUY:  Leader enters a position on this bot's trading pair → copy it
  - SELL: Leader exits the position → follow (close trade)
  - SELL (override): Own stop-loss or take-profit threshold hit
  - HOLD (paused): Max daily loss limit exceeded

Risk controls (all configurable):
  - stop_loss_pct:     Close position if loss exceeds X% vs entry (default 5%)
  - take_profit_pct:   Close position if profit exceeds X% vs entry (default 10%)
  - max_daily_loss_pct: Pause bot for rest of day if cumulative realized daily
                        loss exceeds X% (default 15%)

How leader state is injected:
  BotRunner fetches the leader's positions before calling on_candle(), then
  calls bot.set_leader_state(has_position, leader_pair_symbols) so the bot
  has up-to-date information when generating its signal.

Config schema:
  {
    "leader_portfolio_id": "3953748A4FE10DFA97B2E5A5E4641B82",  -- from Binance URL
    "timeframe":           "1m",       -- tick interval (1m recommended)
    "stop_loss_pct":       5.0,        -- close on -5% loss vs entry
    "take_profit_pct":     10.0,       -- close on +10% gain vs entry
    "max_daily_loss_pct":  15.0,       -- pause after -15% realized daily loss
    "position_size_pct":   95.0,       -- % of balance to use per trade
  }
"""

from __future__ import annotations

import logging

from app.core.bot_base import BaseBot, Candle, Signal

logger = logging.getLogger("trading_bot_arena")


class CopyTradingBot(BaseBot):
    """Paper-trading bot that mirrors a Binance lead trader's positions."""

    def __init__(self, bot_id: str, config: dict, virtual_balance: float) -> None:
        super().__init__(bot_id, config, virtual_balance)

        self.leader_portfolio_id: str = str(config.get("leader_portfolio_id", ""))
        self.stop_loss_pct: float = float(config.get("stop_loss_pct", 5.0))
        self.take_profit_pct: float = float(config.get("take_profit_pct", 10.0))
        self.max_daily_loss_pct: float = float(config.get("max_daily_loss_pct", 15.0))

        # ── Internal state ──────────────────────────────────────────────────────

        # Leader position state — injected by BotRunner before each tick
        self._leader_in_position: bool = False
        self._leader_api_error: str | None = None

        # Position tracking for SL/TP (approximate — uses candle close as proxy)
        self._in_position: bool = False
        self._entry_price: float | None = None

        # Daily loss guard
        self._day_key: str = ""          # YYYY-MM-DD bucket
        self._daily_realized_loss: float = 0.0  # cumulative loss % for today
        self._paused_today: bool = False

    # ── Leader state injection ─────────────────────────────────────────────────

    def set_leader_state(
        self,
        has_position: bool,
        api_error: str | None = None,
    ) -> None:
        """
        Called by BotRunner immediately before on_candle().
        has_position: True if the leader currently holds a position on this pair.
        api_error:    Non-None string if the API call failed.
        """
        self._leader_in_position = has_position
        self._leader_api_error = api_error

    # ── Main signal logic ──────────────────────────────────────────────────────

    def on_candle(self, candle: Candle) -> Signal | None:
        # Day boundary — reset daily counters on new UTC day
        day_key = str(candle.timestamp // 86_400_000)  # epoch-ms → day bucket
        if day_key != self._day_key:
            self._day_key = day_key
            self._daily_realized_loss = 0.0
            self._paused_today = False

        # ── Daily loss guard ───────────────────────────────────────────────────
        if self._paused_today:
            return Signal(
                action="hold",
                confidence=0.0,
                reason=(
                    f"Max daily loss hit ({self.max_daily_loss_pct}%) "
                    "— paused until next UTC day"
                ),
            )

        # ── Risk checks on open position ──────────────────────────────────────
        if self._in_position and self._entry_price is not None:
            current_pnl_pct = (
                (candle.close - self._entry_price) / self._entry_price * 100.0
            )

            if current_pnl_pct <= -self.stop_loss_pct:
                self._record_sell(current_pnl_pct)
                return Signal(
                    action="sell",
                    confidence=1.0,
                    reason=(
                        f"Stop-Loss triggered: {current_pnl_pct:.2f}% "
                        f"(limit: -{self.stop_loss_pct}%)"
                    ),
                )

            if current_pnl_pct >= self.take_profit_pct:
                self._record_sell(current_pnl_pct)
                return Signal(
                    action="sell",
                    confidence=1.0,
                    reason=(
                        f"Take-Profit triggered: +{current_pnl_pct:.2f}% "
                        f"(target: +{self.take_profit_pct}%)"
                    ),
                )

        # ── Leader API unavailable — hold ─────────────────────────────────────
        if self._leader_api_error:
            return Signal(
                action="hold",
                confidence=0.0,
                reason=f"Leader API unavailable: {self._leader_api_error}",
            )

        # ── Mirror leader ─────────────────────────────────────────────────────
        if self._leader_in_position and not self._in_position:
            self._in_position = True
            self._entry_price = candle.close
            return Signal(
                action="buy",
                confidence=0.8,
                reason=(
                    f"Leader entered position — copying trade "
                    f"(SL: -{self.stop_loss_pct}%, TP: +{self.take_profit_pct}%)"
                ),
            )

        if not self._leader_in_position and self._in_position:
            pnl_pct = (
                (candle.close - self._entry_price) / self._entry_price * 100.0
                if self._entry_price
                else 0.0
            )
            self._record_sell(pnl_pct)
            return Signal(
                action="sell",
                confidence=0.8,
                reason=f"Leader exited position — closing copy trade (approx PnL: {pnl_pct:.2f}%)",
            )

        # ── Holding ───────────────────────────────────────────────────────────
        if self._in_position and self._entry_price:
            unrealised = (candle.close - self._entry_price) / self._entry_price * 100.0
            status = "in position" if self._leader_in_position else "leader flat"
            return Signal(
                action="hold",
                confidence=0.0,
                reason=f"Copying: {status} | unrealised PnL ≈ {unrealised:.2f}%",
            )

        return Signal(
            action="hold",
            confidence=0.0,
            reason="Waiting for leader to enter — no position",
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    def _record_sell(self, pnl_pct: float) -> None:
        """Update internal state and daily loss tracker after a sell."""
        self._in_position = False
        self._entry_price = None
        if pnl_pct < 0:
            self._daily_realized_loss += abs(pnl_pct)
            if self._daily_realized_loss >= self.max_daily_loss_pct:
                self._paused_today = True
                logger.warning(
                    "Copy Trading Bot paused: max daily loss reached",
                    extra={
                        "bot_id": self.bot_id,
                        "daily_loss": self._daily_realized_loss,
                        "limit": self.max_daily_loss_pct,
                    },
                )

    # ── Config schema ──────────────────────────────────────────────────────────

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "leader_portfolio_id": {"type": "string", "minLength": 1},
                "timeframe": {
                    "type": "string",
                    "enum": ["1m", "5m", "15m", "1h", "4h", "1d"],
                },
                "stop_loss_pct": {"type": "number", "minimum": 0.1, "maximum": 50},
                "take_profit_pct": {"type": "number", "minimum": 0.1, "maximum": 200},
                "max_daily_loss_pct": {"type": "number", "minimum": 1, "maximum": 100},
                "position_size_pct": {"type": "number", "minimum": 1, "maximum": 100},
            },
            "required": ["leader_portfolio_id"],
        }
