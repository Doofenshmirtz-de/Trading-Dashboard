// Drawdown Chart Component
// Displays drawdown from peak over time (always ≤ 0)

import { useMemo } from 'react'
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
import type { Snapshot } from '../../types'

interface DrawdownChartProps {
  snapshots: Snapshot[]
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

// Calculate drawdown series from snapshots
// Drawdown = ((peak - current_value) / peak) * 100
// Always ≤ 0 (0 = no drawdown, negative = percentage loss from peak)
function calculateDrawdown(snapshots: Snapshot[]): Array<{
  timestamp: string
  fullTimestamp: string
  drawdown: number
  peak: number
  totalValue: number
}> {
  if (snapshots.length === 0) return []

  const result: Array<{
    timestamp: string
    fullTimestamp: string
    drawdown: number
    peak: number
    totalValue: number
  }> = []

  let peak = snapshots[0].total_value

  for (const s of snapshots) {
    // Update peak if current value is higher
    if (s.total_value > peak) {
      peak = s.total_value
    }

    // Calculate drawdown as negative percentage
    const drawdown = ((peak - s.total_value) / peak) * 100

    result.push({
      timestamp: fmtChartDate(s.timestamp),
      fullTimestamp: s.timestamp,
      drawdown: -drawdown, // Negative for chart (0 at top, down is negative)
      peak,
      totalValue: s.total_value,
    })
  }

  return result
}

export function DrawdownChart({ snapshots }: DrawdownChartProps) {
  // Calculate drawdown data
  const chartData = useMemo(() => calculateDrawdown(snapshots), [snapshots])

  // Calculate Y domain (always negative or zero)
  const yDomain = useMemo(() => {
    if (chartData.length === 0) return [-0.5, 0] as const
    const minDrawdown = Math.min(...chartData.map((d) => d.drawdown))
    // Add 0.5% padding below minimum
    return [minDrawdown - 0.5, 0] as const
  }, [chartData])

  // Find maximum drawdown for display
  const maxDrawdown = useMemo(() => {
    if (chartData.length === 0) return 0
    return Math.min(...chartData.map((d) => d.drawdown))
  }, [chartData])

  // Empty state
  if (chartData.length < 2) {
    return (
      <div className="w-full h-[280px] bg-slate-800 rounded-xl flex flex-col items-center justify-center gap-3">
        <svg
          className="w-10 h-10 text-slate-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
          />
        </svg>
        <p className="text-slate-500 text-sm">Noch keine Drawdown-Daten verfügbar</p>
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
        <p className="text-red-400 font-semibold">
          Drawdown: {p.drawdown.toFixed(2)}%
        </p>
        <p className="text-slate-300 text-sm mt-1">
          Peak: ${p.peak.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-slate-400 text-xs mt-1">
          Current: ${p.totalValue.toLocaleString('de-DE', { minimumFractionDigits: 2 })}
        </p>
      </div>
    )
  }

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />

          <XAxis
            dataKey="timestamp"
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={50}
          />

          <YAxis
            tick={{ fill: '#94a3b8', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            domain={yDomain}
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
            dataKey="drawdown"
            stroke="#ef4444"
            strokeWidth={2}
            fill="url(#drawdownGradient)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: '#ef4444' }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center justify-between mt-2 text-xs">
        <span className="text-slate-500">
          Max Drawdown: <span className="text-red-400 font-medium">{maxDrawdown.toFixed(2)}%</span>
        </span>
        <span className="text-slate-500">
          {chartData.length} Datenpunkte
        </span>
      </div>
    </div>
  )
}
