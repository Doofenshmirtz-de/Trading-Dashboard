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
            # Benötigte Kerzen: ADX braucht mindestens 2*period + 1 für validen Start
            # Plus zusätzliche Puffer für Smoothing
            required_candles = max(
                self.adx_period * 2 + 5,  # Extra Puffer für ADX
                self.bb_period + 5,
                50,  # Minimale Anzahl für stabile Berechnungen
            )
            
            candles = await get_candles(pair, timeframe, required_candles)
            
            logger.info(
                "Regime detection: fetched candles",
                extra={
                    "pair": pair,
                    "timeframe": timeframe,
                    "required": required_candles,
                    "received": len(candles),
                }
            )
            
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
            adx, plus_di, minus_di = self._calculate_adx(highs, lows, closes, self.adx_period)

            # Safe fallback if ADX calculation fails
            if adx is None:
                logger.warning(
                    "ADX calculation returned None — falling back to RANGING",
                    extra={"pair": pair, "timeframe": timeframe, "candles": len(candles)}
                )
                from time import time
                return RegimeResult(
                    regime=MarketRegime.RANGING,
                    adx=None,
                    bb_width_pct=None,
                    sma_slope=None,
                    plus_di=None,
                    minus_di=None,
                    timestamp=int(time() * 1000),
                    pair=pair,
                    timeframe=timeframe,
                )

            bb_width = self._calculate_bb_width(closes)
            sma_slope = self._calculate_sma_slope(closes, period=20)

            # Debug-Logging der berechneten Werte
            logger.info(
                "Regime indicators calculated",
                extra={
                    "pair": pair,
                    "adx": adx,
                    "plus_di": plus_di,
                    "minus_di": minus_di,
                    "bb_width": bb_width,
                    "sma_slope": sma_slope,
                    "candles_used": len(candles),
                }
            )

            # Klassifiziere Regime
            current_sma = sum(closes[-20:]) / 20 if len(closes) >= 20 else closes[-1]
            regime = self._classify_regime(
                adx=adx,
                bb_width=bb_width,
                sma_slope=sma_slope,
                plus_di=plus_di,
                minus_di=minus_di,
                current_close=closes[-1],
                current_sma=current_sma,
            )
            
            logger.info(
                "Regime classified",
                extra={
                    "pair": pair,
                    "regime": regime.value,
                    "adx": adx,
                    "current_price": closes[-1],
                    "sma_50": current_sma,
                }
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
                    "error_type": type(e).__name__,
                },
                exc_info=True,
            )
            return self._fallback_result(pair, timeframe)
    
    def _calculate_adx(
        self,
        highs: list[float],
        lows: list[float],
        closes: list[float],
        period: int = 14,
    ) -> tuple[float | None, float | None, float | None]:
        """
        Berechne ADX, +DI, -DI mit Wilder's Smoothing.

        Verifizierte Implementation nach den Regeln:
        - TR = max(high-low, |high-prev_close|, |low-prev_close|)
        - +DM = max(high - prev_high, 0) if up > down, else 0
        - -DM = max(prev_low - low, 0) if down > up, else 0
        - Smooth: prev - prev/period + current (Wilder's method)

        Returns:
            Tuple (adx, plus_di, minus_di) oder (None, None, None) bei Fehler
        """
        n = len(highs)
        if n < period * 2 + 1:
            logger.warning(
                "ADX calculation: insufficient data",
                extra={
                    "required": period * 2 + 1,
                    "available": n,
                    "adx_period": period,
                }
            )
            return None, None, None

        # Step 1: True Range and Directional Movement
        tr_list, pdm_list, ndm_list = [], [], []
        for i in range(1, n):
            high, low, prev_close = highs[i], lows[i], closes[i-1]
            prev_high, prev_low = highs[i-1], lows[i-1]

            tr = max(high - low,
                     abs(high - prev_close),
                     abs(low - prev_close))
            pdm = max(high - prev_high, 0) \
                  if (high - prev_high) > (prev_low - low) else 0
            ndm = max(prev_low - low, 0) \
                  if (prev_low - low) > (high - prev_high) else 0

            tr_list.append(tr)
            pdm_list.append(pdm)
            ndm_list.append(ndm)

        # Step 2: Wilder's smoothing (initial = sum of first period)
        atr = sum(tr_list[:period])
        apdm = sum(pdm_list[:period])
        andm = sum(ndm_list[:period])

        dx_list = []
        for i in range(period, len(tr_list)):
            atr  = atr  - (atr  / period) + tr_list[i]
            apdm = apdm - (apdm / period) + pdm_list[i]
            andm = andm - (andm / period) + ndm_list[i]

            pdi = 100 * apdm / atr if atr > 0 else 0
            ndi = 100 * andm / atr if atr > 0 else 0
            dx  = 100 * abs(pdi - ndi) / (pdi + ndi) \
                  if (pdi + ndi) > 0 else 0
            dx_list.append((dx, pdi, ndi))

        if len(dx_list) < period:
            logger.warning(
                "ADX calculation: insufficient DX values",
                extra={
                    "dx_count": len(dx_list),
                    "required": period,
                }
            )
            return None, None, None

        # Step 3: ADX = Wilder's smooth of DX
        adx = sum(d[0] for d in dx_list[:period]) / period
        for dx, pdi, ndi in dx_list[period:]:
            adx = adx - (adx / period) + dx

        last_pdi = dx_list[-1][1]
        last_ndi = dx_list[-1][2]

        logger.debug(
            "ADX calculation complete",
            extra={
                "adx": round(adx, 2),
                "plus_di": round(last_pdi, 2),
                "minus_di": round(last_ndi, 2),
                "dx_count": len(dx_list),
            }
        )

        return round(adx, 2), round(last_pdi, 2), round(last_ndi, 2)
    
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
        4. UNKNOWN (nur wenn wirklich keine Daten)
        """
        # High Volatility Detection (oberste Priorität)
        if bb_width is not None and bb_width > self.bb_width_threshold:
            return MarketRegime.HIGH_VOLATILITY
        
        # Trend Detection (ADX muss vorhanden sein)
        if adx is not None:
            if adx > self.adx_threshold_trend:
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
            if adx < self.adx_threshold_range:
                return MarketRegime.RANGING
            
            # Fallback wenn ADX im mittleren Bereich (20-25)
            if current_close > current_sma:
                return MarketRegime.TRENDING_UP
            else:
                return MarketRegime.TRENDING_DOWN
        
        # Wenn ADX None aber BB Width da ist → Ranging (konservativ)
        if bb_width is not None:
            return MarketRegime.RANGING
        
        # Nur UNKNOWN wenn wirklich gar keine Daten
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
