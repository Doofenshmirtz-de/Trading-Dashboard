from pydantic import BaseModel

VALID_TIMEFRAMES = ["1m", "5m", "15m", "1h", "4h", "1d"]


class TradingPair(BaseModel):
    symbol: str
    base: str
    quote: str
    active: bool


class Candle(BaseModel):
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class Ticker(BaseModel):
    symbol: str
    last: float | None
    change: float | None
    high: float | None
    low: float | None
    volume: float | None
