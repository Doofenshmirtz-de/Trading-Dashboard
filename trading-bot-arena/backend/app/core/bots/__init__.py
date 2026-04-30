"""
Bot Factory Module — erweiterbare Bot-Strategie-Registrierung.

Usage:
    from app.core.bots import BotFactory, IndicatorType
    
    # Bot erstellen
    bot = BotFactory.create(
        indicator="RSI",
        bot_id="uuid",
        config={"period": 14, "oversold": 30, "overbought": 70},
        virtual_balance=10000.0
    )
    
    # Warm-up Kerzen-Anzahl berechnen
    warmup = BotFactory.get_warmup_count("MACD", config)
"""

from enum import Enum
from typing import Type
from app.core.bot_base import BaseBot


class IndicatorType(str, Enum):
    """Unterstützte Bot-Indikatoren."""
    RSI = "RSI"
    MACD = "MACD"
    BOLLINGER = "BOLLINGER"


class BotFactory:
    """
    Erweiterbare Factory für Bot-Strategien.
    
    Neue Bot-Typen können registriert werden ohne Änderungen an BotRunner:
        BotFactory.register(IndicatorType.MY_NEW_BOT, MyNewBot)
    """
    
    _registry: dict[str, Type[BaseBot]] = {}
    
    @classmethod
    def register(cls, indicator: IndicatorType, bot_class: Type[BaseBot]) -> None:
        """
        Registriere einen neuen Bot-Typ.
        
        Args:
            indicator: Der Indikator-Enum-Wert (z.B. IndicatorType.RSI)
            bot_class: Die Bot-Klasse, die BaseBot implementiert
        """
        cls._registry[indicator.value] = bot_class
    
    @classmethod
    def create(cls, indicator: str, **kwargs) -> BaseBot:
        """
        Erstelle eine Bot-Instanz basierend auf dem Indikator.
        
        Args:
            indicator: Der Indikator-Name als String (z.B. "RSI", "MACD")
            **kwargs: Konstruktor-Argumente für den Bot (bot_id, config, virtual_balance)
            
        Returns:
            BaseBot: Die erstellte Bot-Instanz
            
        Raises:
            ValueError: Wenn der Indikator nicht registriert ist
        """
        if indicator not in cls._registry:
            available = list(cls._registry.keys())
            raise ValueError(
                f"Unknown indicator: '{indicator}'. "
                f"Available: {available}"
            )
        return cls._registry[indicator](**kwargs)
    
    @classmethod
    def get_warmup_count(cls, indicator: str, config: dict) -> int:
        """
        Berechne die Anzahl der benötigten Warm-up Kerzen.
        
        Die Anzahl hängt vom Indikator und seiner Konfiguration ab:
        - RSI: period + 1
        - MACD: slow_period + signal_period + 1
        - Bollinger: period + 1
        
        Args:
            indicator: Der Indikator-Name
            config: Die Bot-Konfiguration
            
        Returns:
            int: Anzahl der benötigten historischen Kerzen
        """
        if indicator == "RSI":
            return config.get("period", 14) + 1
        elif indicator == "MACD":
            # MACD benötigt mehr Daten: slow_period + signal_period + 1
            # Für validen MACD und Signal Line
            return (
                config.get("slow_period", 26) + 
                config.get("signal_period", 9) + 1
            )
        elif indicator == "BOLLINGER":
            return config.get("period", 20) + 1
        return 20  # default
    
    @classmethod
    def list_available(cls) -> list[str]:
        """Liste alle verfügbaren Indikatoren auf."""
        return list(cls._registry.keys())


# ── Registrierungen ─────────────────────────────────────────────────────────────
# Diese Imports und Registrierungen geschehen beim Modul-Load
# Reihenfolge wichtig: erst Factory definieren, dann importieren, dann registrieren

from app.core.bots.rsi_bot import RSIBot
from app.core.bots.macd_bot import MACDBot
from app.core.bots.bollinger_bot import BollingerBot

BotFactory.register(IndicatorType.RSI, RSIBot)
BotFactory.register(IndicatorType.MACD, MACDBot)
BotFactory.register(IndicatorType.BOLLINGER, BollingerBot)
