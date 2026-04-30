"""
Market Regime Detection Service — erkennt Marktphasen für Bot-Strategie-Auswahl.

Implementation Notes:
- ADX (Average Directional Index) mit Wilder's Smoothing
  - +DI = 100 * smoothed(+DM) / smoothed(TR)
  - -DI = 100 * smoothed(-DM) / smoothed(TR)
  - DX = 100 * |+DI - -DI| / (+DI + -DI)
  - ADX = smoothed(DX) über period
- Bollinger Band Width = (Upper - Lower) / Middle * 100
- SMA für Trend-Richtung

Regime Classification:
- TRENDING_UP: ADX > 25, Close > SMA, +DI > -DI
- TRENDING_DOWN: ADX > 25, Close < SMA, -DI > +DI
- RANGING: ADX < 20, niedrige Volatilität
- HIGH_VOLATILITY: BB Width > 10%

Falls keine Daten: Fallback zu RANGING (konservativster Ansatz)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Literal

from app.services.binance import get_candles

logger = logging.getLogger("trading_bot_arena")


class MarketRegime(str, Enum):
    """Marktregime-Enumeration für klare Typisierung."""
    TRENDING_UP = "TRENDING_UP"
    TRENDING_DOWN = "TRENDING_DOWN"
    RANGING = "RANGING"
    HIGH_VOLATILITY = "HIGH_VOLATILITY"
    UNKNOWN = "UNKNOWN"


@dataclass
class RegimeResult:
    """Ergebnis der Regime-Analyse."""
    regime: MarketRegime
    adx: float | None
    bb_width_pct: float | None
    sma_slope: float | None  # Positiv = Uptrend, Negativ = Downtrend
    plus_di: float | None
    minus_di: float | None
    timestamp: int  # Unix timestamp ms
    pair: str
    timeframe: str


class RegimeService:
    """
    Service für Marktregime-Erkennung.
    
    Usage:
        service = RegimeService()
        result = await service.detect_regime("BTC/USDT:USDT", "1h")
        if result.regime == MarketRegime.TRENDING_UP:
            # Trend-following Bots bevorzugen
    """
    
    def __init__(
        self,
        adx_period: int = 14,
        bb_period: int = 20,
        bb_multiplier: float = 2.0,
        adx_threshold_trend: float = 25.0,
        adx_threshold_range: float = 20.0,
        bb_width_threshold: float = 10.0,
    ):
        self.adx_period = adx_period
        self.bb_period = bb_period
        self.bb_multiplier = bb_multiplier
        self.adx_threshold_trend = adx_threshold_trend
        self.adx_threshold_range = adx_threshold_range
        self.bb_width_threshold = bb_width_threshold
    
    async def detect_regime(
        self,
        pair: str = "BTC/USDT:USDT",
        timeframe: str = "1h",
    ) -> RegimeResult:
        """
        Erkenne das aktuelle Marktregime für ein Trading-Paar.
        
        Args:
            pair: Trading-Paar (z.B. "BTC/USDT:USDT")
            timeframe: Zeitrahmen (z.B. "1h", "4h", "1d")
            
        Returns:
            RegimeResult mit allen Indikator-Werten
            
        Raises:
            Keine Exceptions — bei Fehlern wird RANGING zurückgegeben
        """
        try:
            # Benötigte Kerzen: ADX braucht 2*period für validen Start
            required_candles = max(
                self.adx_period * 2,
                self.bb_period + 5,
            )
            
            candles = await get_candles(pair, timeframe, required_candles)
            
            if len(candles) < required_candles:
                logger.warning(
                    "Insufficient candles for regime detection",
                    extra={
                        "pair": pair,
                        "timeframe": timeframe,
                        "required": required_candles,
                        "received": len(candles),
                    }
                )
                return self._fallback_result(pair, timeframe)
            
            # Extrahiere OHLC-Daten
            highs = [float(c["high"]) for c in candles]
            lows = [float(c["low"]) for c in candles]
            closes = [float(c["close"]) for c in candles]
            timestamps = [int(c["timestamp"]) for c in candles]
            
            # Berechne Indikatoren
            adx, plus_di, minus_di = self._calculate_adx(highs, lows, closes)
            bb_width = self._calculate_bb_width(closes)
            sma_slope = self._calculate_sma_slope(closes, period=20)
            
            # Klassifiziere Regime
            regime = self._classify_regime(
                adx=adx,
                bb_width=bb_width,
                sma_slope=sma_slope,
                plus_di=plus_di,
                minus_di=minus_di,
                current_close=closes[-1],
                current_sma=sum(closes[-20:]) / 20 if len(closes) >= 20 else closes[-1],
            )
            
            return RegimeResult(
                regime=regime,
                adx=adx,
                bb_width_pct=bb_width,
                sma_slope=sma_slope,
                plus_di=plus_di,
                minus_di=minus_di,
                timestamp=timestamps[-1],
                pair=pair,
                timeframe=timeframe,
            )
            
        except Exception as e:
            logger.error(
                "Regime detection failed",
                extra={
                    "pair": pair,
                    "timeframe": timeframe,
                    "error": str(e),
                }
            )
            return self._fallback_result(pair, timeframe)
    
    def _calculate_adx(
        self,
        highs: list[float],
        lows: list[float],
        closes: list[float],
    ) -> tuple[float | None, float | None, float | None]:
        """
        Berechne ADX, +DI, -DI mit Wilder's Smoothing.
        
        Spezifikation:
        - TR = max(high-low, |high-prev_close|, |low-prev_close|)
        - +DM = high - prev_high if positive and > (prev_low - low), else 0
        - -DM = prev_low - low if positive and > (high - prev_high), else 0
        - Smooth mit Wilder's alpha = 1/period
        
        Returns:
            Tuple (adx, plus_di, minus_di) oder (None, None, None) bei Fehler
        """
        n = len(highs)
        if n < self.adx_period * 2:
            return None, None, None
        
        # Berechne True Range und Directional Movement
        tr_values: list[float] = []
        plus_dm_values: list[float] = []
        minus_dm_values: list[float] = []
        
        for i in range(1, n):
            high = highs[i]
            low = lows[i]
            prev_high = highs[i - 1]
            prev_low = lows[i - 1]
            prev_close = closes[i - 1]
            
            # True Range
            tr1 = high - low
            tr2 = abs(high - prev_close)
            tr3 = abs(low - prev_close)
            tr = max(tr1, tr2, tr3)
            tr_values.append(tr)
            
            # Directional Movement
            up_move = high - prev_high
            down_move = prev_low - low
            
            if up_move > down_move and up_move > 0:
                plus_dm_values.append(up_move)
                minus_dm_values.append(0)
            elif down_move > up_move and down_move > 0:
                plus_dm_values.append(0)
                minus_dm_values.append(down_move)
            else:
                plus_dm_values.append(0)
                minus_dm_values.append(0)
        
        # Wilder's Smoothing: Erster Wert ist Summe, danach EMA-ähnlich
        alpha = 1 / self.adx_period
        
        # Initialisiere mit Summe der ersten 'period' Werte
        tr_smooth = sum(tr_values[:self.adx_period])
        plus_dm_smooth = sum(plus_dm_values[:self.adx_period])
        minus_dm_smooth = sum(minus_dm_values[:self.adx_period])
        
        dx_values: list[float] = []
        
        # Berechne DI und DX für jeden Zeitpunkt
        for i in range(self.adx_period, len(tr_values)):
            # Smooth aktualisieren: prev_smooth - (prev_smooth/period) + current
            tr_smooth = tr_smooth - (tr_smooth / self.adx_period) + tr_values[i]
            plus_dm_smooth = plus_dm_smooth - (plus_dm_smooth / self.adx_period) + plus_dm_values[i]
            minus_dm_smooth = minus_dm_smooth - (minus_dm_smooth / self.adx_period) + minus_dm_values[i]
            
            # +DI und -DI
            if tr_smooth > 0:
                plus_di = 100 * plus_dm_smooth / tr_smooth
                minus_di = 100 * minus_dm_smooth / tr_smooth
            else:
                plus_di = 0
                minus_di = 0
            
            # DX (Directional Index)
            di_sum = plus_di + minus_di
            if di_sum > 0:
                dx = 100 * abs(plus_di - minus_di) / di_sum
            else:
                dx = 0
            
            dx_values.append(dx)
        
        # ADX ist geglätteter DX (wieder mit Wilder's Smoothing)
        if len(dx_values) < self.adx_period:
            return None, None, None
        
        adx = sum(dx_values[:self.adx_period]) / self.adx_period
        for i in range(self.adx_period, len(dx_values)):
            adx = adx - (adx / self.adx_period) + dx_values[i]
        
        # Aktuelle DI-Werte (letzte berechnete)
        if len(tr_values) > 0:
            final_idx = len(tr_values) - 1
            tr_smooth = sum(tr_values[max(0, final_idx-self.adx_period+1):final_idx+1])
            plus_dm_smooth = sum(plus_dm_values[max(0, final_idx-self.adx_period+1):final_idx+1])
            minus_dm_smooth = sum(minus_dm_values[max(0, final_idx-self.adx_period+1):final_idx+1])
            
            # Smoothing für finale Werte
            for i in range(max(0, final_idx-self.adx_period+1), final_idx+1):
                tr_smooth = tr_smooth - (tr_smooth / self.adx_period) + tr_values[i]
                plus_dm_smooth = plus_dm_smooth - (plus_dm_smooth / self.adx_period) + plus_dm_values[i]
                minus_dm_smooth = minus_dm_smooth - (minus_dm_smooth / self.adx_period) + minus_dm_values[i]
            
            if tr_smooth > 0:
                plus_di = 100 * plus_dm_smooth / tr_smooth
                minus_di = 100 * minus_dm_smooth / tr_smooth
            else:
                plus_di = 0
                minus_di = 0
        else:
            plus_di = None
            minus_di = None
        
        return adx, plus_di, minus_di
    
    def _calculate_bb_width(self, closes: list[float]) -> float | None:
        """
        Berechne Bollinger Band Width als Prozent.
        
        Width = (Upper - Lower) / Middle * 100
        """
        if len(closes) < self.bb_period:
            return None
        
        recent = closes[-self.bb_period:]
        middle = sum(recent) / self.bb_period
        
        if middle == 0:
            return None
        
        # Population StdDev
        variance = sum((c - middle) ** 2 for c in recent) / self.bb_period
        std_dev = variance ** 0.5
        
        upper = middle + std_dev * self.bb_multiplier
        lower = middle - std_dev * self.bb_multiplier
        
        width_pct = (upper - lower) / middle * 100
        return width_pct
    
    def _calculate_sma_slope(self, closes: list[float], period: int = 20) -> float | None:
        """
        Berechne die Steigung der SMA (Trend-Richtung).
        
        Returns:
            Prozentuale Änderung der SMA über die letzten 'period' Kerzen
        """
        if len(closes) < period * 2:
            return None
        
        # SMA vor 'period' Kerzen
        old_sma = sum(closes[-(period*2):-period]) / period
        # Aktuelle SMA
        current_sma = sum(closes[-period:]) / period
        
        if old_sma == 0:
            return 0
        
        slope_pct = (current_sma - old_sma) / old_sma * 100
        return slope_pct
    
    def _classify_regime(
        self,
        adx: float | None,
        bb_width: float | None,
        sma_slope: float | None,
        plus_di: float | None,
        minus_di: float | None,
        current_close: float,
        current_sma: float,
    ) -> MarketRegime:
        """
        Klassifiziere das Marktregime basierend auf Indikator-Werten.
        
        Priorität:
        1. HIGH_VOLATILITY (extreme Bewegungen)
        2. TRENDING_UP / TRENDING_DOWN (klare Trends)
        3. RANGING (Seitwärtsphase)
        4. UNKNOWN (keine Daten)
        """
        # High Volatility Detection (oberste Priorität)
        if bb_width is not None and bb_width > self.bb_width_threshold:
            return MarketRegime.HIGH_VOLATILITY
        
        # Trend Detection (ADX muss vorhanden sein)
        if adx is not None and adx > self.adx_threshold_trend:
            # Uptrend oder Downtrend?
            if current_close > current_sma:
                # Plus überwiegt Minus?
                if plus_di is not None and minus_di is not None:
                    if plus_di > minus_di:
                        return MarketRegime.TRENDING_UP
                else:
                    return MarketRegime.TRENDING_UP
            else:
                if plus_di is not None and minus_di is not None:
                    if minus_di > plus_di:
                        return MarketRegime.TRENDING_DOWN
                else:
                    return MarketRegime.TRENDING_DOWN
        
        # Ranging Detection (niedriger ADX)
        if adx is not None and adx < self.adx_threshold_range:
            return MarketRegime.RANGING
        
        # Fallback wenn ADX im mittleren Bereich
        if adx is not None:
            if current_close > current_sma:
                return MarketRegime.TRENDING_UP
            else:
                return MarketRegime.TRENDING_DOWN
        
        return MarketRegime.UNKNOWN
    
    def _fallback_result(self, pair: str, timeframe: str) -> RegimeResult:
        """Erzeuge konservativen Fallback bei Fehlern."""
        from time import time
        return RegimeResult(
            regime=MarketRegime.RANGING,  # Konservativster Ansatz
            adx=None,
            bb_width_pct=None,
            sma_slope=None,
            plus_di=None,
            minus_di=None,
            timestamp=int(time() * 1000),
            pair=pair,
            timeframe=timeframe,
        )
    
    def get_regime_fit_score(
        self,
        regime: MarketRegime,
        bot_indicator: str,
    ) -> int:
        """
        Berechne einen "Regime Fit Score" für einen Bot im aktuellen Regime.
        
        Returns:
            Score 0-100 (100 = perfekte Übereinstimmung)
        """
        fit_matrix = {
            MarketRegime.TRENDING_UP: {
                "MACD": 90,
                "RSI": 60,
                "BOLLINGER": 30,
            },
            MarketRegime.TRENDING_DOWN: {
                "MACD": 90,
                "RSI": 60,
                "BOLLINGER": 30,
            },
            MarketRegime.RANGING: {
                "BOLLINGER": 95,  # Mean reversion funktioniert besten in Ranging
                "RSI": 80,
                "MACD": 40,
            },
            MarketRegime.HIGH_VOLATILITY: {
                "BOLLINGER": 70,  # Kann funktionieren aber riskant
                "RSI": 50,
                "MACD": 30,
            },
            MarketRegime.UNKNOWN: {
                "RSI": 50,
                "MACD": 50,
                "BOLLINGER": 50,
            },
        }
        
        scores = fit_matrix.get(regime, {})
        return scores.get(bot_indicator, 50)


# Singleton Instance
regime_service = RegimeService()
