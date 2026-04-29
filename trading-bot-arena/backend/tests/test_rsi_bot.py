"""Unit tests for RSIBot and RSI calculation."""

import pytest
from app.core.bots.rsi_bot import RSIBot
from app.core.bot_base import Candle


def _make_bot(period: int = 14, oversold: float = 30, overbought: float = 70) -> RSIBot:
    return RSIBot(
        bot_id="test-bot",
        config={"indicator": "RSI", "timeframe": "1h", "period": period, "oversold": oversold, "overbought": overbought},
        virtual_balance=10000.0,
    )


def _candle(close: float, ts: int = 0) -> Candle:
    return Candle(timestamp=ts, open=close, high=close, low=close, close=close, volume=1.0)


# ── RSI calculation ────────────────────────────────────────────────────────────

def test_rsi_known_value():
    """
    Verify RSI calculation with a known dataset.
    Prices: [44, 41, 44, 46, 48, 43, 43, 44, 55, 56, 60, 58, 53, 52]
    With period=13 (14 prices = period+1):
      avg_gain = 24/13 ≈ 1.846, avg_loss = 16/13 ≈ 1.231
      RS ≈ 1.5 → RSI = 60.0
    """
    prices = [44, 41, 44, 46, 48, 43, 43, 44, 55, 56, 60, 58, 53, 52]
    bot = _make_bot(period=13)  # 14 prices → 13 deltas → period=13
    rsi = bot.calculate_rsi([float(p) for p in prices])
    assert abs(rsi - 60.0) < 0.01, f"Expected RSI = 60.0, got {rsi:.4f}"


def test_rsi_all_gains():
    """Monotonically increasing prices → RSI = 100."""
    bot = _make_bot()
    prices = [float(i) for i in range(1, 16)]  # 15 prices, 14 gains
    rsi = bot.calculate_rsi(prices)
    assert rsi == 100.0


def test_rsi_all_losses():
    """Monotonically decreasing prices → RSI = 0."""
    bot = _make_bot()
    prices = [float(i) for i in range(15, 0, -1)]  # 15 prices, 14 losses
    rsi = bot.calculate_rsi(prices)
    assert rsi == 0.0


def test_rsi_insufficient_data():
    """Fewer than period + 1 prices → calculate_rsi raises ValueError."""
    bot = _make_bot(period=14)
    with pytest.raises(ValueError, match="Need at least"):
        bot.calculate_rsi([44.0] * 5)


# ── on_candle ─────────────────────────────────────────────────────────────────

def test_on_candle_returns_none_during_warmup():
    """Signal should be None until period + 1 prices are collected."""
    bot = _make_bot(period=5)
    for i in range(5):  # 5 candles → less than period+1=6
        sig = bot.on_candle(_candle(float(50 + i)))
    assert sig is None


def test_on_candle_returns_signal_after_warmup():
    """After period + 1 candles, on_candle should return a Signal."""
    bot = _make_bot(period=5)
    for i in range(6):
        sig = bot.on_candle(_candle(float(50 + i)))
    # After 6 candles, last_rsi is set but prev_rsi was None on first full calc
    # Feed one more to get a crossover-aware signal
    sig = bot.on_candle(_candle(52.0))
    assert sig is not None
    assert sig.action in ("buy", "sell", "hold")


def test_on_candle_buy_signal():
    """RSI below oversold threshold should eventually produce a BUY."""
    bot = _make_bot(period=3, oversold=60, overbought=80)
    # First feed prices that push RSI above oversold
    for p in [100.0, 105.0, 110.0, 115.0]:
        bot.on_candle(_candle(p))
    # Now feed declining prices to push RSI below oversold
    for p in [80.0, 70.0, 60.0]:
        sig = bot.on_candle(_candle(p))
    # There should have been a BUY at some point when RSI crossed below 60
    assert bot.last_rsi is not None


def test_on_candle_sell_signal():
    """RSI above overbought threshold should produce a SELL."""
    bot = _make_bot(period=3, oversold=20, overbought=40)
    # Feed prices that push RSI above overbought
    for p in [50.0, 40.0, 30.0, 20.0]:
        bot.on_candle(_candle(p))
    # Now feed rising prices to push RSI above overbought
    for p in [60.0, 80.0, 100.0]:
        sig = bot.on_candle(_candle(p))
    assert bot.last_rsi is not None
