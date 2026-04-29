"""
Virtual Portfolio Engine — simulates paper trading with realistic constraints.

Each bot gets its own engine instance. Tracks balance, open position,
and produces trade dicts ready for Supabase insert.

Slippage model (pessimistic):
  Buy entry price  = candle.close * 1.0005  (+0.05%)
  Sell exit price  = candle.close * 0.9995  (-0.05%)

Fee model (Binance taker default):
  fee_rate = 0.0004  (0.04% of trade value)

Position sizing:
  position_size_pct from bot config (default 95%)
  Minimum balance to open: 10 USDT

# TODO Phase 4: Replace fixed slippage with order-book walk simulation
# TODO Phase 4: Add stop_loss_pct and take_profit_pct from config
"""

from __future__ import annotations

from app.core.bot_base import Candle, Signal

SLIPPAGE = 0.0005
MIN_BALANCE_USDT = 10.0


class VirtualPortfolioEngine:
    def __init__(
        self,
        bot_id: str,
        initial_balance: float,
        fee_rate: float = 0.0004,
        position_size_pct: float = 95.0,
    ) -> None:
        self.bot_id = bot_id
        self.balance = initial_balance
        self.fee_rate = fee_rate
        self.position_size_pct = position_size_pct
        self.position: dict | None = None  # open position or None

    # ── Execution ──────────────────────────────────────────────────────────────

    def execute(self, signal: Signal, candle: Candle, user_id: str) -> dict | None:
        """
        Execute a signal. Returns a trade dict on execution, else None.
        The returned dict is ready for direct Supabase insert into bot_trades.
        """
        if signal.action == "hold":
            return None

        if signal.action == "buy":
            return self._execute_buy(signal, candle, user_id)

        if signal.action == "sell":
            return self._execute_sell(signal, candle, user_id)

        return None

    def _execute_buy(self, signal: Signal, candle: Candle, user_id: str) -> dict | None:
        if self.position is not None:
            return None  # already in a position
        if self.balance < MIN_BALANCE_USDT:
            return None

        entry_price = candle.close * (1 + SLIPPAGE)
        spend = self.balance * (self.position_size_pct / 100.0)
        fee = spend * self.fee_rate
        net_spend = spend - fee  # USDT actually spent on the asset
        quantity = net_spend / entry_price

        self.balance -= spend
        self.position = {
            "entry_price": entry_price,
            "quantity": quantity,
            "value_usdt": net_spend,
            "candle_timestamp": candle.timestamp,
        }

        return {
            "bot_id": self.bot_id,
            "user_id": user_id,
            "action": "buy",
            "price": entry_price,
            "quantity": quantity,
            "value_usdt": net_spend,
            "fee_usdt": fee,
            "pnl_usdt": None,
            "pnl_pct": None,
            "signal_reason": signal.reason,
            "confidence": signal.confidence,
            "candle_timestamp": candle.timestamp,
        }

    def _execute_sell(self, signal: Signal, candle: Candle, user_id: str) -> dict | None:
        if self.position is None:
            return None  # nothing to sell

        exit_price = candle.close * (1 - SLIPPAGE)
        gross_proceeds = self.position["quantity"] * exit_price
        fee = gross_proceeds * self.fee_rate
        net_proceeds = gross_proceeds - fee

        entry_value = self.position["value_usdt"]
        pnl_usdt = net_proceeds - entry_value
        pnl_pct = (pnl_usdt / entry_value) * 100.0 if entry_value > 0 else 0.0

        self.balance += net_proceeds
        quantity = self.position["quantity"]
        self.position = None

        return {
            "bot_id": self.bot_id,
            "user_id": user_id,
            "action": "sell",
            "price": exit_price,
            "quantity": quantity,
            "value_usdt": net_proceeds,
            "fee_usdt": fee,
            "pnl_usdt": round(pnl_usdt, 8),
            "pnl_pct": round(pnl_pct, 4),
            "signal_reason": signal.reason,
            "confidence": signal.confidence,
            "candle_timestamp": candle.timestamp,
        }

    # ── Portfolio queries ──────────────────────────────────────────────────────

    def get_position_value(self, current_price: float) -> float:
        """Current market value of open position in USDT."""
        if self.position is None:
            return 0.0
        return self.position["quantity"] * current_price

    def get_total_value(self, current_price: float) -> float:
        """Cash balance + unrealised position value."""
        return self.balance + self.get_position_value(current_price)

    def get_pnl_pct(self, initial_balance: float, current_price: float) -> float:
        """((total_value - initial_balance) / initial_balance) * 100"""
        if initial_balance <= 0:
            return 0.0
        total = self.get_total_value(current_price)
        return ((total - initial_balance) / initial_balance) * 100.0

    # ── State reconstruction ───────────────────────────────────────────────────

    def reconstruct_from_trades(self, trades: list[dict]) -> None:
        """
        Replay trade history to restore engine state after a restart.
        Trades must be ordered by created_at ASC.
        The last unmatched BUY becomes the current open position.
        """
        self.position = None
        # Walk through all trades to rebuild balance and position
        for t in trades:
            if t["action"] == "buy":
                self.position = {
                    "entry_price": float(t["price"]),
                    "quantity": float(t["quantity"]),
                    "value_usdt": float(t["value_usdt"]),
                    "candle_timestamp": t["candle_timestamp"],
                }
                self.balance -= float(t["value_usdt"]) + float(t["fee_usdt"])
            elif t["action"] == "sell":
                self.balance += float(t["value_usdt"])
                self.position = None
