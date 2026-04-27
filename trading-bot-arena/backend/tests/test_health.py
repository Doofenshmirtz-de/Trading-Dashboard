import pytest
from unittest.mock import patch, AsyncMock, MagicMock


@pytest.mark.asyncio
async def test_health_returns_200(unauthenticated_client):
    with (
        patch(
            "app.routers.health._check_binance",
            new=AsyncMock(return_value=(True, 42, None)),
        ),
        patch(
            "app.routers.health._check_supabase",
            new=AsyncMock(return_value=(True, 10, None)),
        ),
    ):
        resp = await unauthenticated_client.get("/health")

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] in ("ok", "degraded", "error")
    assert "environment" in data
    assert "services" in data


@pytest.mark.asyncio
async def test_health_schema_fields(unauthenticated_client):
    with (
        patch(
            "app.routers.health._check_binance",
            new=AsyncMock(return_value=(True, 55, None)),
        ),
        patch(
            "app.routers.health._check_supabase",
            new=AsyncMock(return_value=(True, 12, None)),
        ),
    ):
        resp = await unauthenticated_client.get("/health")

    data = resp.json()
    services = data["services"]
    for svc in ("binance", "supabase"):
        assert svc in services
        assert "connected" in services[svc]
        assert "latency_ms" in services[svc]
        assert "last_error" in services[svc]


@pytest.mark.asyncio
async def test_health_degraded_when_one_service_fails(unauthenticated_client):
    with (
        patch(
            "app.routers.health._check_binance",
            new=AsyncMock(return_value=(False, None, "timeout")),
        ),
        patch(
            "app.routers.health._check_supabase",
            new=AsyncMock(return_value=(True, 8, None)),
        ),
    ):
        resp = await unauthenticated_client.get("/health")

    assert resp.json()["status"] == "degraded"


@pytest.mark.asyncio
async def test_health_error_when_both_fail(unauthenticated_client):
    with (
        patch(
            "app.routers.health._check_binance",
            new=AsyncMock(return_value=(False, None, "timeout")),
        ),
        patch(
            "app.routers.health._check_supabase",
            new=AsyncMock(return_value=(False, None, "conn refused")),
        ),
    ):
        resp = await unauthenticated_client.get("/health")

    assert resp.json()["status"] == "error"
