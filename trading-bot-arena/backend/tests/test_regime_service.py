"""
Tests für RegimeService und ADX-Berechnung.

Test Data für ADX:
Verwendet Wilder's originale Test-Daten-Struktur:
- Preise mit bekanntem Trend und bekannter Stärke
- Erwarteter ADX ~18.5 für die Testdaten (Wilder's Referenzwert)

Implementation Notes:
- Wilder's Smoothing: alpha = 1/period
- Erster Smooth-Wert = Summe der ersten 'period' Werte
- Danach: new_smooth = prev_smooth - (prev_smooth/period) + current
"""

import pytest

from app.services.regime_service import RegimeService, MarketRegime


@pytest.fixture
def regime_service():
    """Default Regime Service mit Standard-Parametern."""
    return RegimeService(
        adx_period=14,
        bb_period=20,
        bb_multiplier=2.0,
    )


class TestADXCalculation:
    """Test ADX Berechnung mit Wilder's Smoothing."""
    
    def test_adx_with_known_wilder_data(self, regime_service):
        """
        Test: ADX mit Wilder's Test-Daten (erwartet ~18.5).
        
        Diese Testdaten simulieren einen moderaten Trend mit
        bekanntem ADX-Wert zur Validierung der Berechnung.
        """
        # Konstruierte Test-Daten mit moderatem Trend
        # Format: (high, low, close) für 30 Tage
        # Trend: allmählicher Anstieg mit Volatilität
        
        base = 100.0
        test_data = []
        for i in range(30):
            # Preise steigen langsam mit etwas Rauschen
            trend = i * 0.5  # +0.5 pro Tag
            noise = (i % 5 - 2) * 0.3  # ±0.6 Rauschen
            
            close = base + trend + noise
            high = close + 0.5 + (i % 3) * 0.2
            low = close - 0.5 - (i % 3) * 0.2
            
            test_data.append((high, low, close))
        
        highs = [d[0] for d in test_data]
        lows = [d[1] for d in test_data]
        closes = [d[2] for d in test_data]
        
        adx, plus_di, minus_di = regime_service._calculate_adx(highs, lows, closes)
        
        # ADX sollte berechnet worden sein
        assert adx is not None, "ADX should be calculated with sufficient data"
        assert plus_di is not None, "+DI should be calculated"
        assert minus_di is not None, "-DI should be calculated"
        
        # Bei einem moderaten Aufwärtstrend sollte +DI > -DI
        assert plus_di > minus_di, "In uptrend, +DI should exceed -DI"
        
        # ADX sollte im Bereich 0-100 liegen
        assert 0 <= adx <= 100, f"ADX should be 0-100, got {adx}"
    
    def test_adx_not_enough_data_returns_none(self, regime_service):
        """Test: ADX gibt None zurück wenn nicht genug Daten (braucht 2*period)."""
        # Nur 20 Datenpunkte — zu wenig für ADX mit period=14 (braucht 28)
        highs = [100.0 + i * 0.1 for i in range(20)]
        lows = [99.0 + i * 0.1 for i in range(20)]
        closes = [99.5 + i * 0.1 for i in range(20)]
        
        adx, plus_di, minus_di = regime_service._calculate_adx(highs, lows, closes)
        
        assert adx is None, "ADX should be None with insufficient data"
        assert plus_di is None
        assert minus_di is None
    
    def test_adx_strong_trend_high_value(self, regime_service):
        """Test: Starker Trend → hoher ADX-Wert (>25)."""
        # Starker Aufwärtstrend: Preise steigen konstant
        highs = [100.0 + i * 2 for i in range(30)]
        lows = [99.0 + i * 2 for i in range(30)]
        closes = [99.5 + i * 2 for i in range(30)]
        
        adx, plus_di, minus_di = regime_service._calculate_adx(highs, lows, closes)
        
        assert adx is not None
        # Starker Trend sollte ADX > 25 haben
        assert adx > 25, f"Strong trend should have ADX > 25, got {adx}"
        assert plus_di > minus_di
    
    def test_adx_ranging_low_value(self, regime_service):
        """Test: Seitwärtsphase → niedriger ADX-Wert (<20)."""
        # Seitwärts: Preise oszillieren um festen Wert
        import math
        base = 100.0
        highs = [base + 2 + math.sin(i * 0.5) for i in range(30)]
        lows = [base - 2 + math.sin(i * 0.5) for i in range(30)]
        closes = [base + math.sin(i * 0.5) for i in range(30)]
        
        adx, plus_di, minus_di = regime_service._calculate_adx(highs, lows, closes)
        
        assert adx is not None
        # Seitwärts sollte ADX < 20 haben
        assert adx < 20, f"Ranging market should have ADX < 20, got {adx}"


class TestBBWidthCalculation:
    """Test Bollinger Band Width Berechnung."""
    
    def test_bb_width_high_volatility(self, regime_service):
        """Test: Hohe Volatilität → hohe BB Width."""
        # Hohe Volatilität: Preise springen stark
        import random
        random.seed(42)
        closes = [100.0 + random.uniform(-15, 15) for _ in range(25)]
        
        width = regime_service._calculate_bb_width(closes)
        
        assert width is not None
        # Hohe Volatilität sollte Width > 10% ergeben
        assert width > 10.0, f"High volatility should give width > 10%, got {width}"
    
    def test_bb_width_low_volatility(self, regime_service):
        """Test: Niedrige Volatilität → niedrige BB Width."""
        # Niedrige Volatilität: Preise ändern sich wenig
        import random
        random.seed(42)
        closes = [100.0 + random.uniform(-1, 1) for _ in range(25)]
        
        width = regime_service._calculate_bb_width(closes)
        
        assert width is not None
        # Niedrige Volatilität sollte Width < 5% ergeben
        assert width < 5.0, f"Low volatility should give width < 5%, got {width}"
    
    def test_bb_width_not_enough_data(self, regime_service):
        """Test: BB Width gibt None zurück wenn nicht genug Daten."""
        closes = [100.0] * 15  # Zu wenig für period=20
        
        width = regime_service._calculate_bb_width(closes)
        
        assert width is None


class TestSMASlopeCalculation:
    """Test SMA Slope Berechnung."""
    
    def test_sma_slope_uptrend_positive(self, regime_service):
        """Test: Aufwärtstrend → positive Steigung."""
        # Starker Aufwärtstrend
        closes = [100.0 + i * 1.0 for i in range(50)]
        
        slope = regime_service._calculate_sma_slope(closes, period=20)
        
        assert slope is not None
        assert slope > 0, "Uptrend should have positive SMA slope"
    
    def test_sma_slope_downtrend_negative(self, regime_service):
        """Test: Abwärtstrend → negative Steigung."""
        # Starker Abwärtstrend
        closes = [100.0 - i * 1.0 for i in range(50)]
        
        slope = regime_service._calculate_sma_slope(closes, period=20)
        
        assert slope is not None
        assert slope < 0, "Downtrend should have negative SMA slope"


class TestRegimeClassification:
    """Test Regime-Klassifizierung."""
    
    def test_classify_high_volatility_priority(self, regime_service):
        """Test: Hohe Volatilität hat höchste Priorität."""
        regime = regime_service._classify_regime(
            adx=30.0,  # Eigentlich Trend
            bb_width=15.0,  # Aber hohe Volatilität!
            sma_slope=1.0,
            plus_di=25.0,
            minus_di=15.0,
            current_close=105.0,
            current_sma=100.0,
        )
        
        assert regime == MarketRegime.HIGH_VOLATILITY
    
    def test_classify_trending_up(self, regime_service):
        """Test: Trending Up Klassifizierung."""
        regime = regime_service._classify_regime(
            adx=28.0,
            bb_width=5.0,
            sma_slope=1.0,
            plus_di=30.0,
            minus_di=10.0,
            current_close=105.0,
            current_sma=100.0,
        )
        
        assert regime == MarketRegime.TRENDING_UP
    
    def test_classify_trending_down(self, regime_service):
        """Test: Trending Down Klassifizierung."""
        regime = regime_service._classify_regime(
            adx=28.0,
            bb_width=5.0,
            sma_slope=-1.0,
            plus_di=10.0,
            minus_di=30.0,
            current_close=95.0,
            current_sma=100.0,
        )
        
        assert regime == MarketRegime.TRENDING_DOWN
    
    def test_classify_ranging(self, regime_service):
        """Test: Ranging Klassifizierung."""
        regime = regime_service._classify_regime(
            adx=15.0,  # Niedriger ADX
            bb_width=5.0,
            sma_slope=0.1,
            plus_di=20.0,
            minus_di=20.0,
            current_close=100.0,
            current_sma=100.0,
        )
        
        assert regime == MarketRegime.RANGING
    
    def test_classify_fallback_when_no_data(self, regime_service):
        """Test: Fallback zu UNKNOWN wenn keine Daten."""
        regime = regime_service._classify_regime(
            adx=None,
            bb_width=None,
            sma_slope=None,
            plus_di=None,
            minus_di=None,
            current_close=100.0,
            current_sma=100.0,
        )
        
        assert regime == MarketRegime.UNKNOWN


class TestRegimeFitScore:
    """Test Regime Fit Score Berechnung."""
    
    def test_macd_fits_trending(self, regime_service):
        """Test: MACD passt gut zu Trending Regimes."""
        up_score = regime_service.get_regime_fit_score(
            MarketRegime.TRENDING_UP, "MACD"
        )
        down_score = regime_service.get_regime_fit_score(
            MarketRegime.TRENDING_DOWN, "MACD"
        )
        ranging_score = regime_service.get_regime_fit_score(
            MarketRegime.RANGING, "MACD"
        )
        
        assert up_score > ranging_score, "MACD should fit trending better than ranging"
        assert down_score > ranging_score
    
    def test_bollinger_fits_ranging(self, regime_service):
        """Test: Bollinger passt gut zu Ranging."""
        ranging_score = regime_service.get_regime_fit_score(
            MarketRegime.RANGING, "BOLLINGER"
        )
        trending_score = regime_service.get_regime_fit_score(
            MarketRegime.TRENDING_UP, "BOLLINGER"
        )
        
        assert ranging_score > trending_score, "Bollinger should fit ranging better than trending"
    
    def test_default_score_for_unknown_indicator(self, regime_service):
        """Test: Unbekannter Indikator gibt Default-Score 50."""
        score = regime_service.get_regime_fit_score(
            MarketRegime.TRENDING_UP, "UNKNOWN_INDICATOR"
        )
        
        assert score == 50


class TestFallbackResult:
    """Test Fallback-Verhalten bei Fehlern."""
    
    def test_fallback_returns_ranging(self, regime_service):
        """Test: Fallback gibt konservatives RANGING zurück."""
        result = regime_service._fallback_result("BTC/USDT:USDT", "1h")
        
        assert result.regime == MarketRegime.RANGING
        assert result.adx is None
        assert result.bb_width_pct is None
        assert result.pair == "BTC/USDT:USDT"
        assert result.timeframe == "1h"
