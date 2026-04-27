from typing import Literal
from pydantic import BaseModel, Field
from app.core.exceptions import InvalidBotTransitionError

ALLOWED_TRANSITIONS: dict[str, list[str]] = {
    "stopped": ["running"],
    "running": ["paused", "stopped"],
    "paused": ["running", "stopped"],
}


def validate_transition(current: str, next_status: str) -> None:
    allowed = ALLOWED_TRANSITIONS.get(current, [])
    if next_status not in allowed:
        raise InvalidBotTransitionError(
            f"Cannot transition from '{current}' to '{next_status}'. "
            f"Allowed: {allowed}"
        )


BOT_CONFIG_REQUIREMENTS: dict[str, list[str]] = {
    "rule_based": ["indicator", "timeframe"],
    "copy_trading": ["trader_id"],
    "ml": ["model_name"],
    "custom": [],
}


def validate_bot_config(bot_type: str, config: dict) -> None:
    required_fields = BOT_CONFIG_REQUIREMENTS.get(bot_type, [])
    missing = [f for f in required_fields if f not in config]
    if missing:
        raise ValueError(
            f"Bot type '{bot_type}' requires config fields: {required_fields}. "
            f"Missing: {missing}"
        )


BotType = Literal["rule_based", "copy_trading", "ml", "custom"]
BotStatus = Literal["running", "paused", "stopped"]


class BotBase(BaseModel):
    name: str = Field(..., min_length=3, max_length=64)
    type: BotType
    config: dict = Field(default_factory=dict)
    virtual_balance: float = Field(default=10000, ge=100)
    initial_balance: float = Field(default=10000, ge=100)
    trading_pair: str = Field(default="BTC/USDT:USDT")


class CreateBotRequest(BotBase):
    pass


class UpdateBotRequest(BaseModel):
    name: str | None = None
    status: BotStatus | None = None
    config: dict | None = None
    trading_pair: str | None = None
    virtual_balance: float | None = None


class BotResponse(BotBase):
    id: str
    user_id: str
    status: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}
