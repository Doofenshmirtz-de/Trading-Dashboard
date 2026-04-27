from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Candle:
    timestamp: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Signal:
    action: str           # "buy" | "sell" | "hold"
    confidence: float     # 0.0 to 1.0
    reason: str


@dataclass
class Trade:
    entry_price: float
    exit_price: float | None
    action: str
    timestamp: int
    closed: bool = False
    pnl: float = 0.0


class BaseBot(ABC):
    def __init__(
        self,
        bot_id: str,
        config: dict,
        virtual_balance: float,
    ) -> None:
        self.bot_id = bot_id
        self.config = config
        self.virtual_balance = virtual_balance
        self.initial_balance = virtual_balance
        self.position: Trade | None = None
        self.trades: list[Trade] = field(default_factory=list)  # type: ignore[assignment]

    @abstractmethod
    def on_candle(self, candle: Candle) -> Signal | None:
        pass

    @abstractmethod
    def get_config_schema(self) -> dict:
        pass

    def get_performance(self) -> dict:
        closed = [t for t in self.trades if t.closed]
        wins = [t for t in closed if t.pnl > 0]
        pnl_pct = (
            (self.virtual_balance - self.initial_balance) / self.initial_balance * 100
        )
        return {
            "total_trades": len(closed),
            "win_rate": len(wins) / len(closed) if closed else 0,
            "pnl_pct": round(pnl_pct, 4),
            "virtual_balance": self.virtual_balance,
        }
