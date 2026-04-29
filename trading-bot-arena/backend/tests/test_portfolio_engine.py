"""Unit tests for VirtualPortfolioEngine."""

import pytest
from app.core.portfolio_engine import VirtualPortfolioEngine
from app.core.bot_base import Candle, Signal

SLIPPAGE = 0.0005
FEE = 0.0004


def _engine(balance: float = 1000.0, position_size_pct: float = 95.0) -> VirtualPortfolioEngine:
    return VirtualPortfolioEngine(
        bot_id="test-bot",
        initial_balance=balance,
        fee_rate=FEE,
        position_size_pct=position_size_pct,
    )


def _candle(close: float, ts: int = 1_000_000) -> Candle:
    return Candle(timestamp=ts, open=close, high=close, low=close, close=close, volume=1.0)


def _signal(action: str) -> Signal:
    return Signal(action=action, confidence=0.8, reason=f"test {action}")


# ── Buy ────────────────────────────────────────────────────────────────────────

def test_buy_creates_position():
    eng = _engine(balance=1000.0, position_size_pct=100.0)
    trade = eng.execute(_signal("buy"), _candle(50000.0), "user1")
    assert trade is not None
    assert trade["action"] == "buy"
    assert eng.position is not None
    assert eng.position["entry_price"] == pytest.approx(50000.0 * (1 + SLIPPAGE), rel=1e-6)


def test_buy_deducts_balance():
    eng = _engine(balance=1000.0, position_size_pct=100.0)
    eng.execute(_signal("buy"), _candle(50000.0), "user1")
    # Balance should be ~0 (all spent), within fee tolerance
    assert eng.balance < 1.0


def test_no_double_buy():
    eng = _engine()
    eng.execute(_signal("buy"), _candle(50000.0), "user1")
    second = eng.execute(_signal("buy"), _candle(50000.0), "user1")
    assert second is None


def test_buy_below_min_balance():
    eng = _engine(balance=5.0)  # below 10 USDT minimum
    trade = eng.execute(_signal("buy"), _candle(50000.0), "user1")
    assert trade is None
    assert eng.position is None


# ── Sell ───────────────────────────────────────────────────────────────────────

def test_sell_without_position_returns_none():
    eng = _engine()
    trade = eng.execute(_signal("sell"), _candle(50000.0), "user1")
    assert trade is None


def test_buy_and_sell_pnl():
    """Buy at 50000, sell at 55000 → ~+9.6% after fees and slippage."""
    eng = _engine(balance=1000.0, position_size_pct=100.0)
    eng.execute(_signal("buy"), _candle(50000.0), "user1")
    trade = eng.execute(_signal("sell"), _candle(55000.0), "user1")

    assert trade is not None
    assert trade["action"] == "sell"
    assert trade["pnl_pct"] is not None
    # ~9.6% gain (10% price move minus 2×slippage and 2×fee ≈ 0.4% total drag)
    assert 9.0 < trade["pnl_pct"] < 10.5, f"Expected ~9.6%, got {trade['pnl_pct']}"
    assert eng.position is None


def test_sell_loss():
    """Buy at 50000, sell at 45000 → negative PnL."""
    eng = _engine(balance=1000.0, position_size_pct=100.0)
    eng.execute(_signal("buy"), _candle(50000.0), "user1")
    trade = eng.execute(_signal("sell"), _candle(45000.0), "user1")
    assert trade["pnl_pct"] < 0


# ── Hold ───────────────────────────────────────────────────────────────────────

def test_hold_returns_none():
    eng = _engine()
    trade = eng.execute(_signal("hold"), _candle(50000.0), "user1")
    assert trade is None


# ── Portfolio value helpers ────────────────────────────────────────────────────

def test_position_value_no_position():
    eng = _engine()
    assert eng.get_position_value(50000.0) == 0.0


def test_total_value_with_position():
    eng = _engine(balance=1000.0, position_size_pct=100.0)
    eng.execute(_signal("buy"), _candle(50000.0), "user1")
    # total_value ≈ initial_balance (minus fees+slippage drag)
    total = eng.get_total_value(50000.0)
    assert 980.0 < total < 1000.0, f"Unexpected total: {total}"


# ── Reconstruction ─────────────────────────────────────────────────────────────

def test_reconstruct_open_position():
    """Replay a buy trade → engine should have open position."""
    eng = _engine(balance=1000.0)
    trades = [
        {
            "action": "buy",
            "price": 50025.0,
            "quantity": 0.019,
            "value_usdt": 950.475,
            "fee_usdt": 3.802,
            "candle_timestamp": 1_000_000,
        }
    ]
    eng.balance = 1000.0
    eng.reconstruct_from_trades(trades)
    assert eng.position is not None
    assert eng.position["entry_price"] == 50025.0


def test_reconstruct_closed_position():
    """Buy then sell → engine should have no open position."""
    eng = _engine(balance=0.0)
    trades = [
        {
            "action": "buy",
            "price": 50025.0,
            "quantity": 0.019,
            "value_usdt": 950.0,
            "fee_usdt": 0.38,
            "candle_timestamp": 1_000_000,
        },
        {
            "action": "sell",
            "price": 55000.0,
            "quantity": 0.019,
            "value_usdt": 1044.5,
            "fee_usdt": 0.42,
            "candle_timestamp": 2_000_000,
        },
    ]
    eng.reconstruct_from_trades(trades)
    assert eng.position is None
