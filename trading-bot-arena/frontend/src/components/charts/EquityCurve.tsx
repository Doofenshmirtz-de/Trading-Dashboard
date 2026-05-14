// Equity Curve Chart Component
// Displays PnL % over time with gradient fill, timeframe selector, and stale data warning

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts'
import { fetchBotSnapshots } from '../../lib/api'
import type { Snapshot } from '../../types'

interface EquityCurveProps {
  botId: string
  initialBalance: number
  onSnapshotsLoaded?: (snapshots: Snapshot[]) => void
}

type TimeframeOption = {
  label: string
  limit: number
  resolution: string
}

const TIMEFRAME_OPTIONS: Record<string, TimeframeOption> = {
  '1D': { label: '1D', limit: 1440, resolution: '1m' },
  '1W': { label: '1W', limit: 168, resolution: '1h' },
  '1M': { label: '1M', limit: 720, resolution: '1h' },
  'ALL': { label: 'ALL', limit: 5000, resolution: '4h' },
}

// Format date as "DD.MM HH:mm" using native Date methods only
function fmtChartDate(iso: string): string {
  const d = new Date(iso)
  const day = d.getDate().toString().padStart(2, '0')
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const hours = d.getHours().toString().padStart(2, '0')
  const minutes = d.getMinutes().toString().padStart(2, '0')
  return `${day}.${month} ${hours}:${minutes}`
}

// Format full date for tooltip
function fmtFullDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('de-DE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCurrency(n: number): string {
  return n.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// Calculate X-axis interval based on data length to prevent overlapping labels
function calculateXAxisInterval(dataLength: number): number {
  if (dataLength > 200) return Math.floor(dataLength / 8)
  if (dataLength > 50) return Math.floor(dataLength / 6)
  return 0
}

export function EquityCurve({ botId, initialBalance, onSnapshotsLoaded }: EquityCurveProps) {
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1W')
  const timeframeConfig = TIMEFRAME_OPTIONS[selectedTimeframe]

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['bot-snapshots', botId, 'equity-curve', selectedTimeframe],
    queryFn: () => fetchBotSnapshots(botId, timeframeConfig.limit, timeframeConfig.resolution),
    refetchInterval: 60_000,
    enabled: !!botId,
  })

  const snapshots = data?.snapshots ?? []

  // Notify parent when snapshots are loaded (for sharing with DrawdownChart)
  useMemo(() => {
    if (snapshots.length > 0 && onSnapshotsLoaded) {
      onSnapshotsLoaded(snapshots)
    }
  }, [snapshots, onSnapshotsLoaded])

  // Chart data transformation
  const chartData = useMemo(() => {
    return snapshots.map((s) => ({
      timestamp: fmtChartDate(s.timestamp),
      fullTimestamp: s.timestamp,
      pnlPct: s.pnl_pct,
      totalValue: s.total_value,
      btcPrice: s.btc_price,
    }))
  }, [snapshots])

  // Determine color based on last PnL
  const lastSnapshot = snapshots[snapshots.length - 1]
  const lastPnL = chartData.length > 0 ? chartData[chartData.length - 1].pnlPct : 0
  const isPositive = lastPnL >= 0
  const strokeColor = isPositive ? '#22c55e' : '#ef4444'
  const gradientId = isPositive ? 'pnlGradientGreen' : 'pnlGradientRed'

  // Check for stale data (no update in > 2 hours)
  const hoursSinceUpdate = useMemo(() => {
    if (!lastSnapshot) return 0
    const lastTimestamp = new Date(lastSnapshot.timestamp).getTime()
    return (Date.now() - lastTimestamp) / 3600000
  }, [lastSnapshot])

  const isStale = hoursSinceUpdate > 2

  // Calculate X-axis interval
  const xAxisInterval = useMemo(() => calculateXAxisInterval(chartData.length), [chartData.length])

  // Timeframe selector buttons
  const TimeframeButtons = () => (
    <div className="flex gap-1">
      {Object.keys(TIMEFRAME_OPTIONS).map((tf) => (
        <button
          key={tf}
          onClick={() => setSelectedTimeframe(tf)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            selectedTimeframe === tf
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
          }`}
        >
          {TIMEFRAME_OPTIONS[tf].label}
        </button>
      ))}
    </div>
  )

  // Stale data warning banner
  const StaleWarning = () => {
    if (!isStale) return null
    const hours = Math.floor(hoursSinceUpdate)
    return (
      <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
        <p className="text-amber-400 text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          Keine neuen Daten seit {hours} {hours === 1 ? 'Stunde' : 'Stunden'} — Bot-Ticker prüfen
        </p>
      </div>
    )
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="w-full h-[320px] bg-slate-800 rounded-xl animate-pulse" />
    )
  }

  // Error state
  if (error) {
    return (
      <div className="w-full h-[320px] bg-slate-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <p className="text-slate-400 text-sm">Chart konnte nicht geladen werden</p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg transition-colors"
        >
          Erneut versuchen
        </button>
      </div>
    )
  }

  // Empty state
  if (chartData.length < 2) {
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
        <p className="text-slate-300 font-medium">Noch keine Daten</p>
        <p className="text-slate-500 text-sm text-center max-w-xs">
          Der Bot muss mindestens einen Candle-Zyklus durchlaufen.
        </p>
      </div>
    )
  }

  // Custom tooltip component
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{payload: typeof chartData[0]}> }) => {
    if (!active || !payload || !payload.length) return null
    const p = payload[0].payload

    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 shadow-lg">
        <p className="text-slate-400 text-xs mb-1">{fmtFullDate(p.fullTimestamp)}</p>
        <p className={`font-semibold ${p.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          PnL: {p.pnlPct >= 0 ? '+' : ''}{p.pnlPct.toFixed(2)}%
        </p>
        <p className="text-white text-sm mt-1">
          Value: ${formatCurrency(p.totalValue)}
        </p>
        {p.btcPrice && (
          <p className="text-slate-400 text-xs mt-1">
            BTC: ${formatCurrency(p.btcPrice)}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="w-full">
      <StaleWarning />

      <div className="flex items-center justify-between mb-4">
        <TimeframeButtons />
        <span className="text-xs text-slate-500">
          {snapshots.length} Datenpunkte
        </span>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={strokeColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={strokeColor} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />

          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval={xAxisInterval}
            minTickGap={60}
          />

          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            domain={['auto', 'auto']}
            width={55}
          />

          <Tooltip content={<CustomTooltip />} />

          <ReferenceLine
            y={0}
            stroke="#475569"
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          <Area
            type="monotone"
            dataKey="pnlPct"
            stroke={strokeColor}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: strokeColor }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
        <span>Start: ${formatCurrency(initialBalance)}</span>
        <span className={isPositive ? 'text-green-400' : 'text-red-400'}>
          Aktuell: {lastPnL >= 0 ? '+' : ''}{lastPnL.toFixed(2)}%
        </span>
      </div>
    </div>
  )
}
