"""
Bollinger Band Bot — Mean Reversion Strategie.

Implementation Notes:
- SMA = sum(prices[-period:]) / period
- Std Dev: POPULATION std dev — sqrt(sum((x - mean)²) / N)
  WICHTIG: Nicht statistics.stdev() verwenden — das ist SAMPLE std dev (N-1)
- Bollinger verwendet bewusst Population Std Dev (N)
- Upper Band = SMA + (std_dev * multiplier)
- Lower Band = SMA - (std_dev * multiplier)

Strategy:
- BUY: price closes below lower band (mean reversion up expected)
- SELL: price closes above upper band (mean reversion down expected)
- HOLD: price within bands

Requirements:
- Need at least 'period' candles before first signal
- Standard: period=20, multiplier=2.0 (configurable)
"""

from app.core.bot_base import BaseBot, Candle, Signal


class BollingerBot(BaseBot):
    """Bollinger Band Mean Reversion Bot mit Population Std Dev."""
    
    def __init__(self, bot_id: str, config: dict, virtual_balance: float) -> None:
        super().__init__(bot_id, config, virtual_balance)
        
        # Config mit Defaults
        self.period: int = int(config.get("period", 20))
        self.std_dev_multiplier: float = float(config.get("std_dev_multiplier", 2.0))
        
        # Price History
        self.prices: list[float] = []
        
        # Last known bands for state tracking
        self.last_lower: float | None = None
        self.last_middle: float | None = None
        self.last_upper: float | None = None
    
    def calculate_bands(
        self, 
        prices: list[float], 
        period: int, 
        multiplier: float
    ) -> tuple[float, float, float]:
        """
        Berechne Bollinger Bands.
        
        Spezifikation:
        - SMA = sum(recent_prices) / period
        - Std Dev = sqrt(sum((x - SMA)²) / N)  # Population (N), nicht Sample (N-1)
        - Upper = SMA + std_dev * multiplier
        - Lower = SMA - std_dev * multiplier
        
        Args:
            prices: Liste von Closing-Preisen
            period: Lookback-Periode für SMA
            multiplier: Multiplikator für Std Dev
            
        Returns:
            Tuple (lower, middle, upper) Band-Werte
        """
        recent = prices[-period:]
        
        # Middle Band = SMA
        middle = sum(recent) / period
        
        # Population Standard Deviation (N, nicht N-1)
        # Wichtig: Bollinger Bands verwenden bewusst Population Std Dev
        variance = sum((p - middle) ** 2 for p in recent) / period
        std_dev = variance ** 0.5
        
        upper = middle + std_dev * multiplier
        lower = middle - std_dev * multiplier
        
        return lower, middle, upper
    
    def on_candle(self, candle: Candle) -> Signal | None:
        """
        Process new candle and generate signal.
        
        Returns:
            Signal bei Band-Durchbruch, sonst None (Hold)
        """
        self.prices.append(candle.close)
        
        # Minimale Daten für validen Bollinger
        if len(self.prices) < self.period:
            return None
        
        # Berechne Bands
        lower, middle, upper = self.calculate_bands(
            self.prices, 
            self.period, 
            self.std_dev_multiplier
        )
        
        # Speichere für nächsten Candle
        self.last_lower = lower
        self.last_middle = middle
        self.last_upper = upper
        
        # Determine position relative to bands
        price = candle.close
        
        # BUY: Price closes below lower band
        if price < lower:
            deviation = (lower - price) / lower * 100
            return Signal(
                action="buy",
                confidence=min(1.0, deviation / 5.0 + 0.5),  # Confidence based on deviation
                reason=(
                    f"Price ${price:.2f} below lower band ${lower:.2f} "
                    f"(BB: ${lower:.2f} / ${middle:.2f} / ${upper:.2f}) — BUY"
                ),
            )
        
        # SELL: Price closes above upper band
        if price > upper:
            deviation = (price - upper) / upper * 100
            return Signal(
                action="sell",
                confidence=min(1.0, deviation / 5.0 + 0.5),
                reason=(
                    f"Price ${price:.2f} above upper band ${upper:.2f} "
                    f"(BB: ${lower:.2f} / ${middle:.2f} / ${upper:.2f}) — SELL"
                ),
            )
        
        # HOLD: Price within bands
        return None
    
    def get_config_schema(self) -> dict:
        """JSON Schema für Bollinger Konfiguration."""
        return {
            "type": "object",
            "properties": {
                "indicator": {"type": "string", "const": "BOLLINGER"},
                "timeframe": {
                    "type": "string",
                    "enum": ["1m", "5m", "15m", "1h", "4h", "1d"]
                },
                "period": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 100,
                    "default": 20
                },
                "std_dev_multiplier": {
                    "type": "number",
                    "minimum": 0.5,
                    "maximum": 5.0,
                    "default": 2.0
                }
            },
            "required": ["indicator", "timeframe"]
        }
