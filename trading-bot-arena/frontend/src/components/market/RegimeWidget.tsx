/**
 * RegimeWidget — Zeigt das aktuelle Marktregime mit visuellen Indikatoren.
 *
 * Regimes:
 * - TRENDING_UP: Grün, Trend-following Bots bevorzugen
 * - TRENDING_DOWN: Rot, Trend-following Bots bevorzugen (Short)
 * - RANGING: Gelb/Orange, Mean-reversion Bots bevorzugen
 * - HIGH_VOLATILITY: Lila, Vorsicht — hohes Risiko
 * - UNKNOWN: Grau, keine Daten
 */

import { useQuery } from "@tanstack/react-query";
import { fetchMarketRegime } from "../../lib/api";

interface RegimeWidgetProps {
  symbol?: string;
  timeframe?: string;
  className?: string;
}

type MarketRegime =
  | "TRENDING_UP"
  | "TRENDING_DOWN"
  | "RANGING"
  | "HIGH_VOLATILITY"
  | "UNKNOWN";

interface RegimeResponse {
  regime: MarketRegime;
  pair: string;
  timeframe: string;
  timestamp: number;
  indicators: {
    adx: number | null;
    bb_width_pct: number | null;
    sma_slope: number | null;
    plus_di: number | null;
    minus_di: number | null;
  };
}

const REGIME_CONFIG: Record<
  MarketRegime,
  {
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    icon: string;
    description: string;
    botRecommendation: string;
  }
> = {
  TRENDING_UP: {
    label: "Trending Up",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    icon: "📈",
    description: "Klarer Aufwärtstrend",
    botRecommendation: "MACD, Momentum-Strategien",
  },
  TRENDING_DOWN: {
    label: "Trending Down",
    color: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/30",
    icon: "📉",
    description: "Klarer Abwärtstrend",
    botRecommendation: "MACD, Trend-following",
  },
  RANGING: {
    label: "Ranging",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    icon: "↔️",
    description: "Seitwärtsphase",
    botRecommendation: "Bollinger Bands, RSI",
  },
  HIGH_VOLATILITY: {
    label: "High Volatility",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    icon: "⚡",
    description: "Extreme Volatilität",
    botRecommendation: "Vorsicht — kleinere Positionen",
  },
  UNKNOWN: {
    label: "Unknown",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
    icon: "❓",
    description: "Keine Daten verfügbar",
    botRecommendation: "Warten auf Daten...",
  },
};

function formatNumber(
  value: number | null | undefined,
  decimals: number = 1
): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(decimals);
}

export function RegimeWidget({
  symbol = "BTC/USDT:USDT",
  timeframe = "1h",
  className = "",
}: RegimeWidgetProps) {
  const { data, isLoading, error } = useQuery<RegimeResponse>({
    queryKey: ["market-regime", symbol, timeframe],
    queryFn: () => fetchMarketRegime(symbol, timeframe),
    refetchInterval: 60000, // Alle 60 Sekunden (Cache-TTL)
    staleTime: 30000,
  });

  const regime: MarketRegime = data?.regime || "UNKNOWN";
  const config = REGIME_CONFIG[regime];
  const indicators = data?.indicators;

  if (isLoading) {
    return (
      <div
        className={`rounded-xl border border-slate-700 bg-slate-800/50 p-4 ${className}`}
      >
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-24 rounded bg-slate-700" />
          <div className="h-8 w-32 rounded bg-slate-700" />
          <div className="h-3 w-full rounded bg-slate-700" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`rounded-xl border border-red-500/30 bg-red-500/10 p-4 ${className}`}
      >
        <div className="flex items-center gap-2 text-red-400">
          <span className="text-lg">⚠️</span>
          <span className="font-medium">Fehler beim Laden</span>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Marktdaten konnten nicht abgerufen werden.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-4 ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{config.icon}</span>
          <div>
            <h3 className={`font-semibold ${config.color}`}>{config.label}</h3>
            <p className="text-xs text-slate-400">
              {symbol} • {timeframe}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500">Letzte Aktualisierung</div>
          <div className="text-xs text-slate-400">
            {data?.timestamp
              ? new Date(data.timestamp).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—"}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-sm text-slate-300">{config.description}</p>

      {/* Indicators Grid */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-800/50 p-2">
          <div className="text-xs text-slate-500">ADX</div>
          <div
            className={`text-sm font-medium ${
              indicators?.adx && indicators.adx > 25
                ? "text-emerald-400"
                : indicators?.adx && indicators.adx < 20
                  ? "text-amber-400"
                  : "text-slate-300"
            }`}
          >
            {formatNumber(indicators?.adx)}
          </div>
          <div className="text-[10px] text-slate-500">
            {indicators?.adx && indicators.adx > 25
              ? "Trend stark"
              : indicators?.adx && indicators.adx < 20
                ? "Kein Trend"
                : "Moderat"}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-2">
          <div className="text-xs text-slate-500">BB Width</div>
          <div
            className={`text-sm font-medium ${
              indicators?.bb_width_pct && indicators.bb_width_pct > 10
                ? "text-purple-400"
                : "text-slate-300"
            }`}
          >
            {formatNumber(indicators?.bb_width_pct)}%
          </div>
          <div className="text-[10px] text-slate-500">
            {indicators?.bb_width_pct && indicators.bb_width_pct > 10
              ? "Hoch"
              : "Normal"}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-2">
          <div className="text-xs text-slate-500">+DI / -DI</div>
          <div className="text-sm font-medium text-slate-300">
            {formatNumber(indicators?.plus_di)} /{" "}
            {formatNumber(indicators?.minus_di)}
          </div>
          <div className="text-[10px] text-slate-500">
            {indicators?.plus_di && indicators?.minus_di
              ? indicators.plus_di > indicators.minus_di
                ? "Bullish"
                : "Bearish"
              : "—"}
          </div>
        </div>

        <div className="rounded-lg bg-slate-800/50 p-2">
          <div className="text-xs text-slate-500">SMA Slope</div>
          <div
            className={`text-sm font-medium ${
              indicators?.sma_slope && indicators.sma_slope > 0
                ? "text-emerald-400"
                : indicators?.sma_slope && indicators.sma_slope < 0
                  ? "text-rose-400"
                  : "text-slate-300"
            }`}
          >
            {indicators?.sma_slope && indicators.sma_slope > 0 ? "+" : ""}
            {formatNumber(indicators?.sma_slope)}%
          </div>
          <div className="text-[10px] text-slate-500">
            {indicators?.sma_slope && indicators.sma_slope > 0
              ? "Steigend"
              : indicators?.sma_slope && indicators.sma_slope < 0
                ? "Fallend"
                : "Flat"}
          </div>
        </div>
      </div>

      {/* Bot Recommendation */}
      <div className="mt-4 rounded-lg border border-slate-700/50 bg-slate-800/30 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🤖</span>
          <span className="text-xs font-medium text-slate-400">
            Bot-Empfehlung:
          </span>
          <span className="text-sm text-slate-200">
            {config.botRecommendation}
          </span>
        </div>
      </div>

      {/* Regime Fit Legend */}
      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500">
        <span className="rounded bg-slate-800 px-1.5 py-0.5">MACD: Trend</span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5">
          Bollinger: Ranging
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5">RSI: Universal</span>
      </div>
    </div>
  );
}

export default RegimeWidget;
