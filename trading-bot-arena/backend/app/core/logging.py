import logging
import sys
from pythonjsonlogger import jsonlogger
from app.config import settings

LOGGER_NAME = "trading_bot_arena"


def setup_logging() -> None:
    logger = logging.getLogger(LOGGER_NAME)

    if logger.handlers:
        return

    log_level = logging.DEBUG if settings.ENVIRONMENT == "development" else logging.INFO
    logger.setLevel(log_level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(log_level)

    formatter = jsonlogger.JsonFormatter(
        fmt="%(asctime)s %(levelname)s %(name)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "level", "name": "service"},
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.propagate = False


def get_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)
