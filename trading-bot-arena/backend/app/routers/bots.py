import re
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query, HTTPException
from app.dependencies import get_current_user
from app.services.supabase import get_supabase_client
from app.models.bot import (
    CreateBotRequest,
    UpdateBotRequest,
    BotResponse,
    validate_transition,
    validate_bot_config,
)
from app.core.exceptions import BotNotFoundError, InvalidBotTransitionError
from app.core.logging import get_logger

router = APIRouter(prefix="/bots", tags=["bots"])
logger = get_logger()

TRADING_PAIR_REGEX = re.compile(r"^[A-Z]+/USDT:USDT$")


def _row_to_response(row: dict) -> BotResponse:
    return BotResponse(
        id=str(row["id"]),
        user_id=str(row["user_id"]),
        name=row["name"],
        type=row["type"],
        status=row["status"],
        config=row.get("config") or {},
        virtual_balance=float(row["virtual_balance"]),
        initial_balance=float(row["initial_balance"]),
        trading_pair=row["trading_pair"],
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _get_bot_or_404(bot_id: str, user_id: str) -> dict:
    client = get_supabase_client()
    resp = (
        client.table("bots")
        .select("*")
        .eq("id", bot_id)
        .eq("user_id", user_id)
        .single()
        .execute()
    )
    if not resp.data:
        raise BotNotFoundError(bot_id)
    return resp.data  # type: ignore[return-value]


@router.get("")
def list_bots(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: dict = Depends(get_current_user),
) -> dict:
    # TODO Phase 3: Replace with cursor-based pagination
    client = get_supabase_client()
    user_id = current_user["user_id"]

    count_resp = (
        client.table("bots")
        .select("id", count="exact")
        .eq("user_id", user_id)
        .execute()
    )
    total = count_resp.count or 0

    data_resp = (
        client.table("bots")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )

    bots = [_row_to_response(row).model_dump() for row in (data_resp.data or [])]
    logger.info("Bots listed", extra={"user_id": user_id, "count": len(bots)})
    return {"bots": bots, "total": total, "limit": limit, "offset": offset}


@router.post("", status_code=201)
def create_bot(
    body: CreateBotRequest,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    user_id = current_user["user_id"]

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Bot name cannot be empty")

    if not TRADING_PAIR_REGEX.match(body.trading_pair):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid trading_pair '{body.trading_pair}'. "
            "Must match pattern like BTC/USDT:USDT",
        )

    try:
        validate_bot_config(body.type, body.config)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    client = get_supabase_client()
    insert_data = {
        "user_id": user_id,
        "name": name,
        "type": body.type,
        "status": "stopped",
        "config": body.config,
        "virtual_balance": body.virtual_balance,
        "initial_balance": body.initial_balance,
        "trading_pair": body.trading_pair,
    }

    resp = client.table("bots").insert(insert_data).execute()
    row = resp.data[0]

    logger.info(
        "Bot created",
        extra={"user_id": user_id, "bot_id": row["id"], "bot_type": body.type},
    )
    return _row_to_response(row)


@router.get("/{bot_id}")
def get_bot(
    bot_id: str,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    row = _get_bot_or_404(bot_id, current_user["user_id"])
    return _row_to_response(row)


@router.patch("/{bot_id}")
def update_bot(
    bot_id: str,
    body: UpdateBotRequest,
    current_user: dict = Depends(get_current_user),
) -> BotResponse:
    user_id = current_user["user_id"]
    current_row = _get_bot_or_404(bot_id, user_id)

    if body.status is not None:
        try:
            validate_transition(current_row["status"], body.status)
        except InvalidBotTransitionError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e
        logger.info(
            "Bot status transition",
            extra={
                "user_id": user_id,
                "bot_id": bot_id,
                "from": current_row["status"],
                "to": body.status,
            },
        )

    if body.trading_pair is not None and not TRADING_PAIR_REGEX.match(body.trading_pair):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid trading_pair '{body.trading_pair}'",
        )

    update_data: dict = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if body.name is not None:
        stripped = body.name.strip()
        if not stripped:
            raise HTTPException(status_code=422, detail="Bot name cannot be empty")
        update_data["name"] = stripped
    if body.status is not None:
        update_data["status"] = body.status
    if body.config is not None:
        update_data["config"] = body.config
    if body.trading_pair is not None:
        update_data["trading_pair"] = body.trading_pair
    if body.virtual_balance is not None:
        update_data["virtual_balance"] = body.virtual_balance

    client = get_supabase_client()
    resp = (
        client.table("bots")
        .update(update_data)
        .eq("id", bot_id)
        .eq("user_id", user_id)
        .execute()
    )
    return _row_to_response(resp.data[0])


@router.delete("/{bot_id}")
def delete_bot(
    bot_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = current_user["user_id"]
    _get_bot_or_404(bot_id, user_id)

    client = get_supabase_client()
    client.table("bots").delete().eq("id", bot_id).eq("user_id", user_id).execute()

    logger.info("Bot deleted", extra={"user_id": user_id, "bot_id": bot_id})
    return {"deleted": True}
