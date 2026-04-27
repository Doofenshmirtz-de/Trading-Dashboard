# TODO Phase 4: Add Celery worker for background bot execution
# TODO Phase 4: Add virtual portfolio engine with slippage simulation

from app.core.logging import get_logger

logger = get_logger()


class BotManager:
    """
    Placeholder for future bot execution engine.
    Phase 4 will add async Celery workers and portfolio simulation.
    """

    def __init__(self) -> None:
        self._running_bots: dict[str, bool] = {}

    def is_running(self, bot_id: str) -> bool:
        return self._running_bots.get(bot_id, False)


bot_manager = BotManager()
