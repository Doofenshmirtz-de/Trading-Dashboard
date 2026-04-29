"""
RSI Rule-Based Bot — Wilder's RSI momentum strategy.

Strategy:
  - Maintain a rolling window of closing prices (length = period + 1)
  - BUY:  RSI crosses BELOW oversold threshold
          (previous RSI > oversold AND current RSI <= oversold)
  - SELL: RSI crosses ABOVE overbought threshold
          (previous RSI < overbought AND current RSI >= overbought)
  - HOLD: everything else

Config schema:
  {
    "indicator":  "RSI",
    "timeframe":  "1h",     -- candle timeframe
    "period":     14,       -- RSI look-back period (default 14)
    "oversold":   30,       -- buy threshold  (default 30)
    "overbought": 70        -- sell threshold (default 70)
  }

Wilder's RSI implementation uses only Python stdlib — no pandas/ta-lib.
"""

from __future__ import annotations

from app.core.bot_base import BaseBot, Candle, Signal


class RSIBot(BaseBot):
    def __init__(self, bot_id: str, config: dict, virtual_balance: float) -> None:
        super().__init__(bot_id, config, virtual_balance)
        self.period: int = int(config.get("period", 14))
        self.oversold: float = float(config.get("oversold", 30))
        self.overbought: float = float(config.get("overbought", 70))
        self.prices: list[float] = []
        self.last_rsi: float | None = None

    # ── RSI calculation ────────────────────────────────────────────────────────

    def calculate_rsi(self, prices: list[float]) -> float:
        """
        Wilder's Smoothed RSI.

        Requires at least period + 1 prices.
        Steps:
          1. Compute period deltas (changes between consecutive closes)
          2. Seed avg_gain / avg_loss using simple average of first period deltas
          3. Apply Wilder's smoothing for remaining deltas:
               avg_gain = (prev_avg_gain * (period - 1) + gain) / period
          4. RS = avg_gain / avg_loss; RSI = 100 - 100 / (1 + RS)
          5. Edge cases: all gains → 100, all losses → 0
        """
        if len(prices) < self.period + 1:
            raise ValueError(f"Need at least {self.period + 1} prices, got {len(prices)}")

        # Use only the most recent period + 1 prices
        window = prices[-(self.period + 1):]
        deltas = [window[i + 1] - window[i] for i in range(len(window) - 1)]

        # Seed: simple average of first period deltas
        seed_gains = [max(d, 0.0) for d in deltas[:self.period]]
        seed_losses = [abs(min(d, 0.0)) for d in deltas[:self.period]]
        avg_gain = sum(seed_gains) / self.period
        avg_loss = sum(seed_losses) / self.period

        # Wilder's smoothing for any additional deltas beyond the seed
        for d in deltas[self.period:]:
            gain = max(d, 0.0)
            loss = abs(min(d, 0.0))
            avg_gain = (avg_gain * (self.period - 1) + gain) / self.period
            avg_loss = (avg_loss * (self.period - 1) + loss) / self.period

        if avg_loss == 0.0:
            return 100.0  # no losses in window
        if avg_gain == 0.0:
            return 0.0    # no gains in window

        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    # ── Bot interface ──────────────────────────────────────────────────────────

    def on_candle(self, candle: Candle) -> Signal | None:
        self.prices.append(candle.close)

        # Not enough data yet — return None silently (warm-up phase)
        if len(self.prices) < self.period + 1:
            return None

        # Keep rolling window lean
        self.prices = self.prices[-(self.period + 1):]

        current_rsi = self.calculate_rsi(self.prices)
        prev_rsi = self.last_rsi

        signal: Signal | None = None

        if prev_rsi is not None:
            if prev_rsi > self.oversold and current_rsi <= self.oversold:
                # Crossover downward through oversold threshold → BUY
                signal = Signal(
                    action="buy",
                    confidence=round(min((self.oversold - current_rsi) / self.oversold + 0.5, 1.0), 3),
                    reason=f"RSI crossed below {self.oversold:.0f} (RSI={current_rsi:.1f}) — BUY signal",
                )
            elif prev_rsi < self.overbought and current_rsi >= self.overbought:
                # Crossover upward through overbought threshold → SELL
                signal = Signal(
                    action="sell",
                    confidence=round(min((current_rsi - self.overbought) / (100 - self.overbought) + 0.5, 1.0), 3),
                    reason=f"RSI crossed above {self.overbought:.0f} (RSI={current_rsi:.1f}) — SELL signal",
                )
            else:
                signal = Signal(
                    action="hold",
                    confidence=0.0,
                    reason=f"RSI={current_rsi:.1f} — no threshold crossing",
                )

        self.last_rsi = current_rsi
        return signal

    def get_config_schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "indicator": {"type": "string", "const": "RSI"},
                "timeframe": {"type": "string", "enum": ["1m", "5m", "15m", "1h", "4h", "1d"]},
                "period": {"type": "integer", "minimum": 2, "maximum": 100},
                "oversold": {"type": "number", "minimum": 10, "maximum": 45},
                "overbought": {"type": "number", "minimum": 55, "maximum": 90},
            },
            "required": ["indicator", "timeframe"],
        }
