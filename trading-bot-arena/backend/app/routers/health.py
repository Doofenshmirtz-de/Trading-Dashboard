import asyncio
import time
from fastapi import APIRouter
from app.services import binance as binance_service
from app.services.supabase import get_supabase_client
from app.core.logging import get_logger

router = APIRouter(tags=["health"])
logger = get_logger()


@router.get("/health")
async def health_check() -> dict:
    binance_ok, binance_latency, binance_error = await _check_binance()
    supabase_ok, supabase_latency, supabase_error = await _check_supabase()

    if binance_ok and supabase_ok:
        status = "ok"
    elif binance_ok or supabase_ok:
        status = "degraded"
    else:
        status = "error"

    result = {
        "status": status,
        "environment": "production",
        "services": {
            "binance": {
                "connected": binance_ok,
                "latency_ms": binance_latency,
                "last_error": binance_error,
            },
            "supabase": {
                "connected": supabase_ok,
                "latency_ms": supabase_latency,
                "last_error": supabase_error,
            },
        },
    }

    logger.info(
        "Health check completed",
        extra={
            "status": status,
            "binance_latency_ms": binance_latency,
            "supabase_latency_ms": supabase_latency,
        },
    )
    return result


async def _check_binance() -> tuple[bool, int | None, str | None]:
    return await binance_service.check_connectivity()


async def _check_supabase() -> tuple[bool, int | None, str | None]:
    t0 = time.time()
    try:
        loop = asyncio.get_event_loop()
        client = get_supabase_client()
        await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: client.table("bots").select("id").limit(1).execute(),
            ),
            timeout=8.0,
        )
        latency = int((time.time() - t0) * 1000)
        return True, latency, None
    except asyncio.TimeoutError:
        return False, None, "Supabase connectivity check timed out (8s)"
    except Exception as e:
        return False, None, str(e)
