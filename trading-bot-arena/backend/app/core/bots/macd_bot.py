"""
MACD Bot — Signal Line Crossover Strategie.

Implementation Notes:
- EMA Formula: EMA = price * k + prev_EMA * (1 - k), where k = 2/(period+1)
- Initialization: EMA[period-1] = SMA(prices[0:period])
- For i < period-1: EMA[i] = None
- For i >= period: EMA[i] = price[i] * k + EMA[i-1] * (1-k)
- MACD Line = EMA(fast) - EMA(slow)
- Signal Line = EMA(macd_line, signal_period)

Strategy:
- BUY: MACD crosses above Signal (prev MACD < Signal, curr MACD > Signal)
- SELL: MACD crosses below Signal (prev MACD > Signal, curr MACD < Signal)
- HOLD: No crossover

Requirements:
- Need slow_period + signal_period candles before first valid signal
- Standard: fast=12, slow=26, signal=9 (configurable)
"""

from app.core.bot_base import BaseBot, Candle, Signal


class MACDBot(BaseBot):
    """MACD Signal Line Crossover Bot mit Wilder's EMA."""
    
    def __init__(self, bot_id: str, config: dict, virtual_balance: float) -> None:
        super().__init__(bot_id, config, virtual_balance)
        
        # Config mit Defaults
        self.fast_period: int = int(config.get("fast_period", 12))
        self.slow_period: int = int(config.get("slow_period", 26))
        self.signal_period: int = int(config.get("signal_period", 9))
        
        # Price History
        self.prices: list[float] = []
        
        # MACD State
        self.last_macd: float | None = None
        self.last_signal: float | None = None
    
    def calculate_ema(self, prices: list[float], period: int) -> list[float | None]:
        """
        Berechne EMA mit Wilder's Smoothing.
        
        Spezifikation:
        - EMA[period-1] = SMA(prices[0:period])  # SMA als Seed
        - Für i < period-1: EMA[i] = None       # Nicht genug Daten
        - Für i >= period: EMA[i] = price[i] * k + EMA[i-1] * (1-k)
        
        Args:
            prices: Liste von Closing-Preisen
            period: EMA-Periode
            
        Returns:
            Liste von EMA-Werten, first (period-1) sind None
        """
        if len(prices) < period:
            return [None] * len(prices)
        
        k = 2 / (period + 1)
        emas: list[float | None] = [None] * (period - 1)
        
        # Initialisiere mit SMA der ersten 'period' Prices
        sma = sum(prices[:period]) / period
        emas.append(sma)
        
        # Continue with EMA formula
        for price in prices[period:]:
            prev_ema = emas[-1]
            if prev_ema is None:
                emas.append(None)
            else:
                ema = price * k + prev_ema * (1 - k)
                emas.append(ema)
        
        return emas
    
    def on_candle(self, candle: Candle) -> Signal | None:
        """
        Process new candle and generate signal.
        
        Returns:
            Signal bei Kreuzung, sonst None (Hold)
        """
        self.prices.append(candle.close)
        
        # Minimale Daten für validen MACD
        min_required = self.slow_period + self.signal_period
        if len(self.prices) < min_required:
            return None
        
        # Berechne EMAs
        ema_fast = self.calculate_ema(self.prices, self.fast_period)
        ema_slow = self.calculate_ema(self.prices, self.slow_period)
        
        # Finde den Index wo beide EMAs gültig sind
        # EMA_fast hat gültige Werte ab fast_period-1
        # EMA_slow hat gültige Werte ab slow_period-1
        # Wir brauchen Werte ab slow_period-1
        valid_start = self.slow_period - 1
        
        # Berechne MACD Line (nur wo beide EMAs gültig)
        macd_line: list[float | None] = []
        for i in range(len(self.prices)):
            if i < valid_start:
                macd_line.append(None)
            elif ema_fast[i] is None or ema_slow[i] is None:
                macd_line.append(None)
            else:
                macd_line.append(ema_fast[i] - ema_slow[i])
        
        # Berechne Signal Line (EMA des MACD)
        # Entferne None-Werte für EMA-Berechnung
        valid_macd = [m for m in macd_line if m is not None]
        if len(valid_macd) < self.signal_period:
            return None
        
        signal_line_values = self.calculate_ema(valid_macd, self.signal_period)
        
        # Re-konstruiere vollständige Signal Line mit None-Padding
        signal_line: list[float | None] = [None] * (len(macd_line) - len(valid_macd))
        signal_line.extend(signal_line_values)
        
        # Aktuelle und vorherige Werte für Crossover-Detection
        current_idx = len(self.prices) - 1
        
        if current_idx < 1:
            return None
        
        curr_macd = macd_line[current_idx]
        prev_macd = macd_line[current_idx - 1]
        
        # Signal Line Index muss korrigiert werden wegen Padding
        signal_idx_offset = len(macd_line) - len(signal_line_values)
        curr_signal_idx = current_idx - signal_idx_offset
        
        if curr_signal_idx < 0 or curr_signal_idx >= len(signal_line_values):
            return None
            
        curr_signal = signal_line_values[curr_signal_idx]
        prev_signal = signal_line_values[curr_signal_idx - 1] if curr_signal_idx > 0 else None
        
        if curr_macd is None or prev_macd is None:
            return None
        if curr_signal is None or prev_signal is None:
            return None
        
        # Speichere für nächsten Candle
        self.last_macd = curr_macd
        self.last_signal = curr_signal
        
        # Crossover Detection
        # BUY: MACD crossed above Signal (prev MACD < Signal, curr MACD > Signal)
        if prev_macd <= prev_signal and curr_macd > curr_signal:
            return Signal(
                action="buy",
                confidence=min(1.0, abs(curr_macd - curr_signal) / abs(curr_signal) + 0.5),
                reason=f"MACD crossed above Signal (MACD={curr_macd:.2f}, Signal={curr_signal:.2f}) — BUY",
            )
        
        # SELL: MACD crossed below Signal (prev MACD > Signal, curr MACD < Signal)
        if prev_macd >= prev_signal and curr_macd < curr_signal:
            return Signal(
                action="sell",
                confidence=min(1.0, abs(curr_macd - curr_signal) / abs(curr_signal) + 0.5),
                reason=f"MACD crossed below Signal (MACD={curr_macd:.2f}, Signal={curr_signal:.2f}) — SELL",
            )
        
        # HOLD: No crossover
        return None
    
    def get_config_schema(self) -> dict:
        """JSON Schema für MACD Konfiguration."""
        return {
            "type": "object",
            "properties": {
                "indicator": {"type": "string", "const": "MACD"},
                "timeframe": {
                    "type": "string",
                    "enum": ["1m", "5m", "15m", "1h", "4h", "1d"]
                },
                "fast_period": {
                    "type": "integer",
                    "minimum": 2,
                    "maximum": 50,
                    "default": 12
                },
                "slow_period": {
                    "type": "integer",
                    "minimum": 5,
                    "maximum": 200,
                    "default": 26
                },
                "signal_period": {
                    "type": "integer",
                    "minimum": 2,
                    "maximum": 50,
                    "default": 9
                }
            },
            "required": ["indicator", "timeframe"]
        }
