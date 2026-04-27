import pytest
from unittest.mock import patch, MagicMock
from tests.conftest import TEST_USER_ID

VALID_BOT = {
    "name": "Test Bot Alpha",
    "type": "rule_based",
    "config": {"indicator": "RSI", "timeframe": "1h"},
    "virtual_balance": 10000,
    "initial_balance": 10000,
    "trading_pair": "BTC/USDT:USDT",
}

MOCK_BOT_ROW = {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "user_id": TEST_USER_ID,
    "name": "Test Bot Alpha",
    "type": "rule_based",
    "status": "stopped",
    "config": {"indicator": "RSI", "timeframe": "1h"},
    "virtual_balance": 10000.0,
    "initial_balance": 10000.0,
    "trading_pair": "BTC/USDT:USDT",
    "created_at": "2026-01-01T00:00:00+00:00",
    "updated_at": "2026-01-01T00:00:00+00:00",
}


def _mock_supabase_insert(row: dict):
    mock_resp = MagicMock()
    mock_resp.data = [row]
    client = MagicMock()
    client.table.return_value.insert.return_value.execute.return_value = mock_resp
    return client


def _mock_supabase_select_list(rows: list, total: int):
    count_resp = MagicMock()
    count_resp.data = [{"id": r["id"]} for r in rows]
    count_resp.count = total

    data_resp = MagicMock()
    data_resp.data = rows

    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value.execute.return_value
    ) = count_resp
    (
        client.table.return_value.select.return_value.eq.return_value.order.return_value.range.return_value.execute.return_value
    ) = data_resp
    return client


@pytest.mark.asyncio
async def test_create_bot_without_jwt_returns_401(unauthenticated_client):
    resp = await unauthenticated_client.post("/bots", json=VALID_BOT)
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_create_bot_with_jwt_returns_201(authenticated_client):
    mock_client = _mock_supabase_insert(MOCK_BOT_ROW)
    with patch("app.routers.bots.get_supabase_client", return_value=mock_client):
        resp = await authenticated_client.post("/bots", json=VALID_BOT)

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "Test Bot Alpha"
    assert data["type"] == "rule_based"
    assert data["status"] == "stopped"
    assert "id" in data
    assert "user_id" in data


@pytest.mark.asyncio
async def test_create_bot_with_invalid_config_returns_422(authenticated_client):
    bad_bot = {**VALID_BOT, "config": {}}  # rule_based requires indicator + timeframe
    resp = await authenticated_client.post("/bots", json=bad_bot)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_create_bot_copy_trading_missing_trader_id_returns_422(authenticated_client):
    bad_bot = {**VALID_BOT, "type": "copy_trading", "config": {}}
    resp = await authenticated_client.post("/bots", json=bad_bot)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_list_bots_returns_paginated_response(authenticated_client):
    mock_client = _mock_supabase_select_list([MOCK_BOT_ROW], total=1)
    with patch("app.routers.bots.get_supabase_client", return_value=mock_client):
        resp = await authenticated_client.get("/bots")

    assert resp.status_code == 200
    data = resp.json()
    assert "bots" in data
    assert "total" in data
    assert "limit" in data
    assert "offset" in data


@pytest.mark.asyncio
async def test_patch_invalid_transition_stopped_to_paused_returns_422(authenticated_client):
    single_resp = MagicMock()
    single_resp.data = MOCK_BOT_ROW

    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
    ) = single_resp

    with patch("app.routers.bots.get_supabase_client", return_value=client):
        resp = await authenticated_client.patch(
            f"/bots/{MOCK_BOT_ROW['id']}", json={"status": "paused"}
        )

    assert resp.status_code == 422
    assert "paused" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_patch_valid_transition_stopped_to_running_returns_200(authenticated_client):
    running_row = {**MOCK_BOT_ROW, "status": "running"}
    single_resp = MagicMock()
    single_resp.data = MOCK_BOT_ROW

    update_resp = MagicMock()
    update_resp.data = [running_row]

    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
    ) = single_resp
    (
        client.table.return_value.update.return_value.eq.return_value.eq.return_value.execute.return_value
    ) = update_resp

    with patch("app.routers.bots.get_supabase_client", return_value=client):
        resp = await authenticated_client.patch(
            f"/bots/{MOCK_BOT_ROW['id']}", json={"status": "running"}
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "running"


@pytest.mark.asyncio
async def test_delete_bot_returns_200(authenticated_client):
    single_resp = MagicMock()
    single_resp.data = MOCK_BOT_ROW

    delete_resp = MagicMock()
    delete_resp.data = [MOCK_BOT_ROW]

    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
    ) = single_resp
    (
        client.table.return_value.delete.return_value.eq.return_value.eq.return_value.execute.return_value
    ) = delete_resp

    with patch("app.routers.bots.get_supabase_client", return_value=client):
        resp = await authenticated_client.delete(f"/bots/{MOCK_BOT_ROW['id']}")

    assert resp.status_code == 200
    assert resp.json()["deleted"] is True


@pytest.mark.asyncio
async def test_get_other_users_bot_returns_404(authenticated_client):
    not_found_resp = MagicMock()
    not_found_resp.data = None

    client = MagicMock()
    (
        client.table.return_value.select.return_value.eq.return_value.eq.return_value.single.return_value.execute.return_value
    ) = not_found_resp

    with patch("app.routers.bots.get_supabase_client", return_value=client):
        resp = await authenticated_client.get("/bots/foreign-bot-id")

    assert resp.status_code == 404
