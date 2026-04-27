import pytest
from unittest.mock import patch, AsyncMock

MOCK_PAIRS = [
    {"symbol": "BTC/USDT:USDT", "base": "BTC", "quote": "USDT", "active": True},
    {"symbol": "ETH/USDT:USDT", "base": "ETH", "quote": "USDT", "active": True},
]


@pytest.mark.asyncio
async def test_get_pairs_without_jwt_returns_401(unauthenticated_client):
    resp = await unauthenticated_client.get("/market/pairs")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_pairs_with_jwt_returns_list(authenticated_client):
    with patch(
        "app.routers.market.binance_service.get_pairs",
        new=AsyncMock(return_value=MOCK_PAIRS),
    ):
        resp = await authenticated_client.get("/market/pairs")

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["symbol"] == "BTC/USDT:USDT"


@pytest.mark.asyncio
async def test_get_candles_invalid_timeframe_returns_422(authenticated_client):
    resp = await authenticated_client.get(
        "/market/candles", params={"symbol": "BTC/USDT:USDT", "timeframe": "99x"}
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_get_candles_valid_returns_200(authenticated_client):
    mock_candles = [
        {
            "timestamp": 1700000000000,
            "open": 40000.0,
            "high": 41000.0,
            "low": 39000.0,
            "close": 40500.0,
            "volume": 100.0,
        }
    ]
    with patch(
        "app.routers.market.binance_service.get_candles",
        new=AsyncMock(return_value=mock_candles),
    ):
        resp = await authenticated_client.get(
            "/market/candles",
            params={"symbol": "BTC/USDT:USDT", "timeframe": "1h", "limit": 1},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert data[0]["close"] == 40500.0


@pytest.mark.asyncio
async def test_get_ticker_without_jwt_returns_401(unauthenticated_client):
    resp = await unauthenticated_client.get(
        "/market/ticker", params={"symbol": "BTC/USDT:USDT"}
    )
    assert resp.status_code == 401
