/**
 * Bot Comparison Dashboard
 *
 * Zeigt alle Bots nebeneinander mit:
 * - Performance-Metriken (PnL, Win Rate, Sharpe, etc.)
 * - Kombinierte Equity Curve Chart
 * - Aktuelles Marktregime
 * - Regime-Fit-Indikatoren pro Bot
 */

import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { fetchComparison } from '../../lib/api'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { BotWithPerformance } from '../../lib/api'

type SortField = 'pnl' | 'win_rate' | 'trades' | 'name'
type SortDirection = 'asc' | 'desc'

const BOT_COLORS = [
  '#3b82f6', // blue
  '#22c55e', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function fmtPrice(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pnlColour(v: number | null | undefined) {
  if (v == null) return 'text-slate-400'
  if (v > 0) return 'text-green-400'
  if (v < 0) return 'text-red-400'
  return 'text-slate-400'
}

function getIndicatorLabel(indicator: string): string {
  const labels: Record<string, string> = {
    RSI: 'RSI',
    MACD: 'MACD',
    BOLLINGER: 'BB',
  }
  return labels[indicator] || indicator
}

function getRegimeColor(regime: string): string {
  const colors: Record<string, string> = {
    TRENDING_UP: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    TRENDING_DOWN: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    RANGING: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    HIGH_VOLATILITY: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
    UNKNOWN: 'text-slate-400 bg-slate-500/10 border-slate-500/30',
  }
  return colors[regime] || colors.UNKNOWN
}

function getRegimeIcon(regime: string): string {
  const icons: Record<string, string> = {
    TRENDING_UP: '📈',
    TRENDING_DOWN: '📉',
    RANGING: '↔️',
    HIGH_VOLATILITY: '⚡',
    UNKNOWN: '❓',
  }
  return icons[regime] || icons.UNKNOWN
}

function getRegimeLabel(regime: string): string {
  const labels: Record<string, string> = {
    TRENDING_UP: 'Trending Up',
    TRENDING_DOWN: 'Trending Down',
    RANGING: 'Ranging',
    HIGH_VOLATILITY: 'High Volatility',
    UNKNOWN: 'Unknown',
  }
  return labels[regime] || regime
}

// ── Comparison Table ─────────────────────────────────────────────────────────

interface ComparisonTableProps {
  bots: BotWithPerformance[]
  sortField: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  onBotClick: (botId: string) => void
}

function ComparisonTable({
  bots,
  sortField,
  sortDirection,
  onSort,
  onBotClick,
}: ComparisonTableProps) {
  const sortedBots = useMemo(() => {
    const sorted = [...bots]
    sorted.sort((a, b) => {
      let comparison = 0
      switch (sortField) {
        case 'pnl':
          comparison = a.performance.total_pnl_pct - b.performance.total_pnl_pct
          break
        case 'win_rate':
          comparison = a.performance.win_rate - b.performance.win_rate
          break
        case 'trades':
          comparison = a.performance.total_trades - b.performance.total_trades
          break
        case 'name':
          comparison = a.bot.name.localeCompare(b.bot.name)
          break
      }
      return sortDirection === 'asc' ? comparison : -comparison
    })
    return sorted
  }, [bots, sortField, sortDirection])

  // Find best bot by PnL
  const bestBotId = useMemo(() => {
    if (bots.length === 0) return null
    return bots.reduce((best, current) =>
      current.performance.total_pnl_pct > best.performance.total_pnl_pct ? current : best
    ).bot.id
  }, [bots])

  const SortHeader = ({
    field,
    label,
    className = '',
  }: {
    field: SortField
    label: string
    className?: string
  }) => {
    const isActive = sortField === field
    return (
      <th
        className={`px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors ${className}`}
        onClick={() => onSort(field)}
      >
        <span className="flex items-center gap-1">
          {label}
          {isActive && (
            <span className="text-slate-500">
              {sortDirection === 'asc' ? '↑' : '↓'}
            </span>
          )}
        </span>
      </th>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-700">
            <SortHeader field="name" label="Bot" className="pl-5" />
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
              Typ
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
              Status
            </th>
            <SortHeader field="pnl" label="PnL %" />
            <SortHeader field="win_rate" label="Win Rate" />
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
              Trades
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">
              Regime Fit
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {sortedBots.map((botData) => {
            const { bot, performance, regime_fit } = botData
            const isBest = bot.id === bestBotId
            const indicator = getIndicatorLabel(performance.indicator)

            return (
              <tr
                key={bot.id}
                className={`hover:bg-slate-700/30 transition-colors ${
                  isBest ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/30' : ''
                }`}
              >
                <td className="px-4 py-3 pl-5">
                  <button
                    onClick={() => onBotClick(bot.id)}
                    className="text-left group"
                  >
                    <p className="text-white font-medium group-hover:text-blue-400 transition-colors">
                      {bot.name}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {bot.trading_pair} • {indicator}
                    </p>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-400 text-xs">
                    {bot.type.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={bot.status} />
                </td>
                <td className="px-4 py-3">
                  <span className={`font-mono font-medium ${pnlColour(performance.total_pnl_pct)}`}>
                    {performance.total_pnl_pct >= 0 ? '+' : ''}
                    {performance.total_pnl_pct.toFixed(2)}%
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-300">
                    {(performance.win_rate * 100).toFixed(1)}%
                  </span>
                  <span className="text-slate-500 text-xs ml-1">
                    ({performance.winning_trades}/{performance.total_trades})
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-300">{performance.total_trades}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span>{regime_fit.emoji}</span>
                    <span
                      className={`text-xs ${
                        regime_fit.score >= 70
                          ? 'text-green-400'
                          : regime_fit.score >= 50
                          ? 'text-yellow-400'
                          : 'text-red-400'
                      }`}
                    >
                      {regime_fit.label}
                    </span>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Combined Equity Chart ──────────────────────────────────────────────────────

interface CombinedChartProps {
  bots: BotWithPerformance[]
}

function CombinedChart({ bots }: CombinedChartProps) {
  // Filter bots that have snapshots
  const botsWithData = useMemo(() => {
    return bots.filter((b) => b.latest_snapshot !== null).slice(0, 8) // Max 8 bots
  }, [bots])

  if (botsWithData.length === 0) {
    return (
      <div className="w-full h-[320px] bg-slate-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <svg
          className="w-12 h-12 text-slate-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
          />
        </svg>
        <p className="text-slate-500 text-sm">Noch keine Daten für Chart verfügbar</p>
      </div>
    )
  }

  // Create a simple representation - show PnL values from latest snapshots
  const data = useMemo(() => {
    return botsWithData.map((bot, index) => ({
      name: bot.bot.name,
      pnl: bot.performance.total_pnl_pct,
      color: BOT_COLORS[index % BOT_COLORS.length],
      trades: bot.performance.total_trades,
    }))
  }, [botsWithData])

  const maxPnL = Math.max(...data.map((d) => d.pnl), 0)
  const minPnL = Math.min(...data.map((d) => d.pnl), 0)
  const yDomain = [Math.min(minPnL - 1, -1), Math.max(maxPnL + 1, 1)]

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            angle={-45}
            textAnchor="end"
            height={60}
            interval={0}
          />
          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            domain={yDomain}
            width={55}
          />
          <ReferenceLine y={0} stroke="#475569" strokeDasharray="4 4" strokeWidth={1} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || !payload.length) return null
              const p = payload[0].payload
              return (
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
                  <p className="text-white font-medium">{p.name}</p>
                  <p className={`text-sm ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    PnL: {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}%
                  </p>
                  <p className="text-slate-400 text-xs">Trades: {p.trades}</p>
                </div>
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="pnl"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, index } = props
              const color = BOT_COLORS[(index || 0) % BOT_COLORS.length]
              return <circle cx={cx} cy={cy} r={5} fill={color} stroke="none" />
            }}
            activeDot={{ r: 7, strokeWidth: 0 }}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-4">
        {botsWithData.map((bot, index) => (
          <div key={bot.bot.id} className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: BOT_COLORS[index % BOT_COLORS.length] }}
            />
            <span className="text-xs text-slate-400">{bot.bot.name}</span>
            <span
              className={`text-xs ${
                bot.performance.total_pnl_pct >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              ({bot.performance.total_pnl_pct >= 0 ? '+' : ''}
              {bot.performance.total_pnl_pct.toFixed(1)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Regime Card ────────────────────────────────────────────────────────────────

interface RegimeCardProps {
  regime: {
    regime: string
    description: string
    recommendation: string
    indicators: {
      adx: number | null
      bb_width_pct: number | null
      sma_slope: number | null
      plus_di: number | null
      minus_di: number | null
    }
  }
}

function RegimeCard({ regime }: RegimeCardProps) {
  const colorClass = getRegimeColor(regime.regime)
  const icon = getRegimeIcon(regime.regime)
  const label = getRegimeLabel(regime.regime)

  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold">{label}</h3>
            <p className="text-xs opacity-80">{regime.description}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs opacity-60">Empfehlung</p>
          <p className="text-sm">{regime.recommendation}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-slate-800/50 rounded-lg p-2">
          <p className="text-xs opacity-60">ADX</p>
          <p className="text-sm font-medium">
            {regime.indicators.adx?.toFixed(1) ?? '—'}
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2">
          <p className="text-xs opacity-60">BB Width</p>
          <p className="text-sm font-medium">
            {regime.indicators.bb_width_pct?.toFixed(1) ?? '—'}%
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2">
          <p className="text-xs opacity-60">+DI / -DI</p>
          <p className="text-sm font-medium">
            {regime.indicators.plus_di?.toFixed(1) ?? '—'} /{' '}
            {regime.indicators.minus_di?.toFixed(1) ?? '—'}
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2">
          <p className="text-xs opacity-60">SMA Slope</p>
          <p className="text-sm font-medium">
            {regime.indicators.sma_slope?.toFixed(2) ?? '—'}%
          </p>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-2">
          <p className="text-xs opacity-60">Trend</p>
          <p className="text-sm font-medium">
            {regime.indicators.plus_di && regime.indicators.minus_di
              ? regime.indicators.plus_di > regime.indicators.minus_di
                ? 'Bullish'
                : 'Bearish'
              : '—'}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export function Comparison() {
  const navigate = useNavigate()
  const [sortField, setSortField] = useState<SortField>('pnl')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const { data, isLoading, error } = useQuery({
    queryKey: ['bots-comparison'],
    queryFn: fetchComparison,
    refetchInterval: 60_000,
  })

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 pt-20 flex items-center justify-center">
        <p className="text-slate-400">Lade Vergleichsdaten...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-red-400">Fehler beim Laden der Daten</p>
        <button
          onClick={() => navigate('/bots')}
          className="text-blue-400 text-sm hover:underline"
        >
          ← Zurück zu Bots
        </button>
      </div>
    )
  }

  const bots = data?.bots || []
  const regime = data?.regime

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={() => navigate('/bots')}
              className="text-slate-400 hover:text-white text-sm mb-2 transition-colors flex items-center gap-1"
            >
              ← Bots
            </button>
            <h1 className="text-2xl font-bold text-white">Bot Vergleich</h1>
            <p className="text-slate-400 text-sm mt-1">
              Vergleiche alle Bots und ihre Performance im aktuellen Marktregime
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">{bots.length} Bots</p>
          </div>
        </div>

        {/* Regime Card */}
        {regime && <RegimeCard regime={regime} />}

        {/* Comparison Table */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-white font-semibold">Vergleichsmetriken</h2>
          </div>
          {bots.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-sm">
              <p>Keine Bots zum Vergleichen vorhanden</p>
              <button
                onClick={() => navigate('/bots')}
                className="text-blue-400 hover:text-blue-300 text-sm mt-2 transition-colors"
              >
                Erstelle deinen ersten Bot →
              </button>
            </div>
          ) : (
            <ComparisonTable
              bots={bots}
              sortField={sortField}
              sortDirection={sortDirection}
              onSort={handleSort}
              onBotClick={(id) => navigate(`/bots/${id}`)}
            />
          )}
        </div>

        {/* Combined Chart */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Performance Übersicht</h2>
            <span className="text-xs text-slate-500">PnL % pro Bot</span>
          </div>
          <CombinedChart bots={bots} />
        </div>

        {/* Legend / Info */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-2">Legende</h3>
          <div className="flex flex-wrap gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1">
              <span>✅</span>
              <span>Passt: Bot ist gut für aktuelles Regime geeignet</span>
            </div>
            <div className="flex items-center gap-1">
              <span>➖</span>
              <span>Neutral: Durchschnittliche Performance erwartet</span>
            </div>
            <div className="flex items-center gap-1">
              <span>⚠️</span>
              <span>Suboptimal: Bot könnte unterperformen</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-yellow-500/30 inline-block" />
              <span>Gelb markiert: Bester Bot nach PnL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
