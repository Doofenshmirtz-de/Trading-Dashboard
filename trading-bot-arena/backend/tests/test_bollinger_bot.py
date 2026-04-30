"""
Tests für BollingerBot.

Test Data für Band Breach:
Wir verwenden konstruierte Daten, die einen klaren Durchbruch der Bollinger Bands zeigen:
- Below Lower Band: BUY Signal (Mean Reversion nach oben erwartet)
- Above Upper Band: SELL Signal (Mean Reversion nach unten erwartet)

Implementation Notes:
- Bollinger Bands verwenden Population Std Dev (N), nicht Sample (N-1)
- Upper = SMA + 2*StdDev
- Lower = SMA - 2*StdDev
"""

import pytest
import math

from app.core.bot_base import Candle, Signal
from app.core.bots.bollinger_bot import BollingerBot


@pytest.fixture
def bollinger_bot():
    """Default Bollinger Bot mit Standard-Parametern (period=20, multiplier=2.0)."""
    return BollingerBot(
        bot_id="test-bb",
        config={
            "indicator": "BOLLINGER",
            "timeframe": "1h",
            "period": 20,
            "std_dev_multiplier": 2.0,
        },
        virtual_balance=10000.0,
    )


class TestBollingerBandBreach:
    """Test Bollinger Band Durchbruch-Detection."""
    
    def test_price_below_lower_band_generates_buy(self, bollinger_bot):
        """
        Test: Preis unter Lower Band → BUY Signal.
        
        Konstruktion:
        - Erst 20 Kerzen mit normalen Preisen für initiale Berechnung
        - Dann eine Kerze weit unter dem Lower Band
        """
        base_price = 50000.0
        
        # Phase 1: 20 Kerzen mit geringer Volatilität (SMA-Basis)
        for i in range(20):
            # Volatilität ±0.5%
            price = base_price + (i % 3 - 1) * 100
            candle = Candle(
                timestamp=i * 1000,
                open=price,
                high=price + 50,
                low=price - 50,
                close=price,
                volume=1000,
            )
            result = bollinger_bot.on_candle(candle)
            assert result is None, f"No signal expected during initialization at candle {i}"
        
        # Phase 2: Preis weit unter dem erwarteten Lower Band
        # Bei Basis-Preis 50000 und StdDev ~100 ist Lower Band ~49800
        crash_price = 49000.0  # Weit unter Lower Band
        
        crash_candle = Candle(
            timestamp=20000,
            open=crash_price,
            high=crash_price + 100,
            low=crash_price - 100,
            close=crash_price,
            volume=5000,
        )
        
        signal = bollinger_bot.on_candle(crash_candle)
        
        assert signal is not None, "Expected signal when price below lower band"
        assert signal.action == "buy", f"Expected BUY, got {signal.action}"
        assert "lower band" in signal.reason.lower() or "BUY" in signal.reason
    
    def test_price_above_upper_band_generates_sell(self, bollinger_bot):
        """
        Test: Preis über Upper Band → SELL Signal.
        
        Konstruktion:
        - Erst 20 Kerzen mit normalen Preisen für initiale Berechnung
        - Dann eine Kerze weit über dem Upper Band
        """
        base_price = 50000.0
        
        # Phase 1: 20 Kerzen mit geringer Volatilität
        for i in range(20):
            price = base_price + (i % 3 - 1) * 100
            candle = Candle(
                timestamp=i * 1000,
                open=price,
                high=price + 50,
                low=price - 50,
                close=price,
                volume=1000,
            )
            bollinger_bot.on_candle(candle)
        
        # Phase 2: Preis weit über dem erwarteten Upper Band
        # Bei Basis-Preis 50000 und StdDev ~100 ist Upper Band ~50200
        pump_price = 51000.0  # Weit über Upper Band
        
        pump_candle = Candle(
            timestamp=21000,
            open=pump_price,
            high=pump_price + 100,
            low=pump_price - 100,
            close=pump_price,
            volume=5000,
        )
        
        signal = bollinger_bot.on_candle(pump_candle)
        
        assert signal is not None, "Expected signal when price above upper band"
        assert signal.action == "sell", f"Expected SELL, got {signal.action}"
        assert "upper band" in signal.reason.lower() or "SELL" in signal.reason
    
    def test_price_within_bands_generates_no_signal(self, bollinger_bot):
        """Test: Preis innerhalb der Bands → Kein Signal (Hold)."""
        base_price = 50000.0
        
        # 25 Kerzen mit geringer Volatilität (Preis innerhalb der Bands)
        for i in range(25):
            # Kleine Schwankungen, aber immer nahe dem Mittelwert
            price = base_price + (i % 5 - 2) * 50  # ±100 von base
            candle = Candle(
                timestamp=i * 1000,
                open=price,
                high=price + 30,
                low=price - 30,
                close=price,
                volume=1000,
            )
            signal = bollinger_bot.on_candle(candle)
            
            # Nach Initialisierung sollte kein Signal kommen (Preis innerhalb Bands)
            if i >= 19:  # Nach Initialisierung
                assert signal is None, f"Expected no signal within bands at candle {i}"


class TestBollingerCalculation:
    """Test Bollinger Bands Berechnung mit Population Std Dev."""
    
    def test_population_std_dev_calculation(self):
        """
        Test: StdDev verwendet Population-Formel (N), nicht Sample (N-1).
        
        Population StdDev = sqrt(sum((x - mean)²) / N)
        Sample StdDev = sqrt(sum((x - mean)²) / (N-1))
        
        Wir verwenden eine bekannte Datenreihe und verifizieren das Ergebnis.
        """
        bot = BollingerBot("test", {"indicator": "BOLLINGER"}, 10000.0)
        
        # Einfache Test-Daten
        # Preise: [90, 100, 110]
        # Mean = 100
        # Deviations: (-10, 0, 10)
        # Squared: (100, 0, 100)
        # Sum of squares = 200
        # Population variance = 200 / 3 = 66.67
        # Population std dev = sqrt(66.67) ≈ 8.165
        # Sample std dev wäre sqrt(200 / 2) = sqrt(100) = 10.0
        
        prices = [90.0, 100.0, 110.0]
        # Wir brauchen mehr Preise wegen Period=20 Default
        # Erweitere auf 20 Preise mit gleicher Struktur
        extended_prices = [100.0] * 17 + [90.0, 100.0, 110.0]
        
        lower, middle, upper = bot.calculate_bands(extended_prices, period=3, multiplier=2.0)
        
        # Verify middle = SMA
        expected_sma = sum(extended_prices[-3:]) / 3
        assert middle == pytest.approx(expected_sma, rel=1e-10)
        
        # Verify bands are symmetric around SMA
        upper_distance = upper - middle
        lower_distance = middle - lower
        assert upper_distance == pytest.approx(lower_distance, rel=1e-10)
        
        # Verify bands width = 2 * std_dev * multiplier
        deviations = [(p - middle) ** 2 for p in extended_prices[-3:]]
        population_variance = sum(deviations) / 3
        population_std_dev = math.sqrt(population_variance)
        
        expected_half_width = population_std_dev * 2.0
        assert upper_distance == pytest.approx(expected_half_width, rel=1e-10)
    
    def test_bollinger_bands_symmetry(self, bollinger_bot):
        """Test: Upper und Lower Bands sind symmetrisch um die SMA."""
        base_price = 50000.0
        
        # Erzeuge Preise mit bekannter Volatilität
        prices = [base_price + (i % 7 - 3) * 200 for i in range(25)]
        
        lower, middle, upper = bollinger_bot.calculate_bands(prices, 20, 2.0)
        
        # Upper und Lower müssen gleichen Abstand zur Mitte haben
        upper_dist = upper - middle
        lower_dist = middle - lower
        assert upper_dist == pytest.approx(lower_dist, rel=1e-10)
    
    def test_not_using_statistics_stdev(self):
        """
        Test: Wir verwenden NICHT statistics.stdev() (Sample StdDev).
        
        Dieser Test verifiziert, dass unsere Berechnung kleiner ist als 
        die Sample StdDev (da N > N-1).
        """
        import statistics
        
        bot = BollingerBot("test", {"indicator": "BOLLINGER"}, 10000.0)
        
        # Test-Daten mit Variation
        prices = [48000.0, 49000.0, 50000.0, 51000.0, 52000.0] * 4  # 20 Preise
        
        # Unsere Population StdDev
        lower, middle, upper = bot.calculate_bands(prices, 20, 1.0)  # multiplier=1
        our_std_dev = (upper - lower) / 2  # Ohne Multiplikator
        
        # Sample StdDev (was statistics.stdev berechnen würde)
        sample_std_dev = statistics.stdev(prices)
        
        # Population StdDev muss kleiner sein als Sample StdDev
        assert our_std_dev < sample_std_dev
        
        # Verifiziere die Relation: Population = Sample * sqrt((N-1)/N)
        n = len(prices)
        expected_ratio = math.sqrt((n - 1) / n)
        actual_ratio = our_std_dev / sample_std_dev
        assert actual_ratio == pytest.approx(expected_ratio, rel=1e-10)


class TestBollingerConfig:
    """Test Konfiguration und Schema."""
    
    def test_default_config_values(self):
        """Test: Standard-Werte werden korrekt gesetzt."""
        bot = BollingerBot(
            bot_id="test",
            config={"indicator": "BOLLINGER", "timeframe": "1h"},  # Minimal config
            virtual_balance=10000.0,
        )
        
        assert bot.period == 20
        assert bot.std_dev_multiplier == 2.0
    
    def test_custom_config_values(self):
        """Test: Benutzerdefinierte Werte werden korrekt gesetzt."""
        bot = BollingerBot(
            bot_id="test",
            config={
                "indicator": "BOLLINGER",
                "timeframe": "5m",
                "period": 10,
                "std_dev_multiplier": 1.5,
            },
            virtual_balance=10000.0,
        )
        
        assert bot.period == 10
        assert bot.std_dev_multiplier == 1.5
    
    def test_get_config_schema_structure(self):
        """Test: Schema enthält alle erforderlichen Felder."""
        bot = BollingerBot("test", {}, 10000.0)
        schema = bot.get_config_schema()
        
        assert schema["type"] == "object"
        assert "indicator" in schema["properties"]
        assert "timeframe" in schema["properties"]
        assert "period" in schema["properties"]
        assert "std_dev_multiplier" in schema["properties"]
        
        # Prüfe Defaults
        assert schema["properties"]["period"]["default"] == 20
        assert schema["properties"]["std_dev_multiplier"]["default"] == 2.0
        
        # Prüfe Constraints
        assert schema["properties"]["period"]["minimum"] == 5
        assert schema["properties"]["period"]["maximum"] == 100
        assert schema["properties"]["std_dev_multiplier"]["minimum"] == 0.5
        assert schema["properties"]["std_dev_multiplier"]["maximum"] == 5.0


class TestBollingerState:
    """Test State-Tracking."""
    
    def test_band_values_tracked(self, bollinger_bot):
        """Test: Band-Werte werden nach Berechnung gespeichert."""
        base_price = 50000.0
        
        # Feed 25 Kerzen
        for i in range(25):
            price = base_price + (i % 5 - 2) * 100
            candle = Candle(
                timestamp=i * 1000,
                open=price,
                high=price + 50,
                low=price - 50,
                close=price,
                volume=1000,
            )
            bollinger_bot.on_candle(candle)
        
        # Nach 25 Kerzen sollten die Band-Werte gesetzt sein
        assert bollinger_bot.last_lower is not None
        assert bollinger_bot.last_middle is not None
        assert bollinger_bot.last_upper is not None
        
        # Reihenfolge: Lower < Middle < Upper
        assert bollinger_bot.last_lower < bollinger_bot.last_middle
        assert bollinger_bot.last_middle < bollinger_bot.last_upper
    
    def test_no_state_before_initialization(self, bollinger_bot):
        """Test: Keine Band-Werte vor Initialisierung."""
        # Feed nur 5 Kerzen (zu wenig)
        for i in range(5):
            candle = Candle(
                timestamp=i * 1000,
                open=50000.0,
                high=50100.0,
                low=49900.0,
                close=50000.0,
                volume=1000,
            )
            bollinger_bot.on_candle(candle)
        
        assert bollinger_bot.last_lower is None
        assert bollinger_bot.last_middle is None
        assert bollinger_bot.last_upper is None
