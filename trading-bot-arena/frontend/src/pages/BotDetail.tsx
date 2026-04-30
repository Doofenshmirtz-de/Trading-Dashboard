// TODO Phase 4: Replace 60s polling with WebSocket/SSE for real-time signals

import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchBotPerformance,
  fetchBotSnapshots,
  fetchBotTrades,
  fetchBotSignals,
  updateBot,
  deleteBot,
} from '../lib/api'
import { useToast } from '../components/ui/Toast'
import { StatusBadge } from '../components/ui/StatusBadge'
import { EquityCurve } from '../components/charts/EquityCurve'
import { DrawdownChart } from '../components/charts/DrawdownChart'
import type { BotStatus, Snapshot } from '../types'

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function pnlColour(v: number | null | undefined, variant: 'text' | 'bg' = 'text') {
  if (v == null) return variant === 'text' ? 'text-slate-400' : 'bg-slate-700'
  if (v > 0) return variant === 'text' ? 'text-green-400' : 'bg-green-600/20'
  if (v < 0) return variant === 'text' ? 'text-red-400' : 'bg-red-600/20'
  return variant === 'text' ? 'text-slate-400' : 'bg-slate-700'
}

function truncate(s: string, n = 40) {
  return s.length > n ? s.slice(0, n) + '…' : s
}

function fmtDurationSince(iso?: string) {
  if (!iso) return '—'
  const startedAt = new Date(iso).getTime()
  if (Number.isNaN(startedAt)) return '—'
  const diffMs = Date.now() - startedAt
  const totalMin = Math.max(0, Math.floor(diffMs / 60000))
  const days = Math.floor(totalMin / (60 * 24))
  const hours = Math.floor((totalMin % (60 * 24)) / 60)
  const mins = totalMin % 60
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// ── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  colour,
}: {
  label: string
  value: string
  sub?: string
  colour?: string
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colour ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}


// ── Page ───────────────────────────────────────────────────────────────────────

export function BotDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show } = useToast()

  const botId = id ?? ''

  // State to share snapshots between EquityCurve and DrawdownChart
  const [sharedSnapshots, setSharedSnapshots] = useState<Snapshot[]>([])

  const perfQuery = useQuery({
    queryKey: ['bot-perf', botId],
    queryFn: () => fetchBotPerformance(botId),
    refetchInterval: 60_000,
    enabled: !!botId,
  })

  const snapshotsQuery = useQuery({
    queryKey: ['bot-snapshots', botId],
    queryFn: () => fetchBotSnapshots(botId, 720, '1h'),
    refetchInterval: 60_000,
    enabled: !!botId,
  })

  const tradesQuery = useQuery({
    queryKey: ['bot-trades', botId],
    queryFn: () => fetchBotTrades(botId, 40),
    refetchInterval: 60_000,
    enabled: !!botId,
  })

  const signalsQuery = useQuery({
    queryKey: ['bot-signals', botId],
    queryFn: () => fetchBotSignals(botId, 50),
    refetchInterval: 60_000,
    enabled: !!botId,
  })

  const bot = snapshotsQuery.data?.bot
  const perf = perfQuery.data
  const snapshots = snapshotsQuery.data?.snapshots ?? []
  const trades = tradesQuery.data?.trades ?? []
  const signals = signalsQuery.data?.signals ?? []

  // Last snapshot for display (prefer sharedSnapshots if available)
  const lastSnapshot = sharedSnapshots.length > 0
    ? sharedSnapshots[sharedSnapshots.length - 1]
    : (snapshots.length > 0 ? snapshots[snapshots.length - 1] : null)
  const config = (bot?.config as Record<string, unknown> | undefined) ?? {}
  const lastSignal = signals.length > 0 ? signals[0] : null
  const debugHint =
    bot?.status === 'running' && signals.length === 0
      ? 'Bot läuft, aber keine Signale vorhanden. Prüfe Railway Logs auf Tick-Fehler.'
      : null

  const updateMutation = useMutation({
    mutationFn: (status: BotStatus) => updateBot(botId, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bot-snapshots', botId] })
      void qc.invalidateQueries({ queryKey: ['bots'] })
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 422) {
        show('Cannot perform this transition from the current state', 'error')
      } else {
        show(err.message || 'Update failed', 'error')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteBot(botId),
    onSuccess: () => {
      show('Bot deleted', 'info')
      navigate('/bots')
    },
    onError: (err: Error) => show(err.message || 'Delete failed', 'error'),
  })

  const isLoading = snapshotsQuery.isLoading && !bot

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 pt-20 flex items-center justify-center">
        <p className="text-slate-400">Loading bot…</p>
      </div>
    )
  }

  if (!bot && !isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 pt-20 flex flex-col items-center justify-center gap-4">
        <p className="text-slate-400">Bot not found.</p>
        <button onClick={() => navigate('/bots')} className="text-blue-400 text-sm hover:underline">
          ← Back to Bots
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate('/bots')}
              className="text-slate-400 hover:text-white text-sm mb-2 transition-colors flex items-center gap-1"
            >
              ← Bots
            </button>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{bot?.name}</h1>
              {bot && <StatusBadge status={bot.status as BotStatus} />}
            </div>
            <p className="text-slate-500 text-sm mt-1 font-mono">{bot?.trading_pair}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {bot?.status === 'stopped' || bot?.status === 'paused' ? (
              <button
                onClick={() => updateMutation.mutate('running')}
                disabled={updateMutation.isPending}
                className="bg-green-600/20 text-green-400 hover:bg-green-600/40 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Start
              </button>
            ) : bot?.status === 'running' ? (
              <button
                onClick={() => updateMutation.mutate('stopped')}
                disabled={updateMutation.isPending}
                className="bg-slate-600/40 text-slate-300 hover:bg-slate-600/60 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                Stop
              </button>
            ) : null}
            <button
              onClick={() => {
                if (confirm(`Delete "${bot?.name ?? 'this bot'}"?`)) deleteMutation.mutate()
              }}
              disabled={deleteMutation.isPending}
              className="bg-red-600/20 text-red-400 hover:bg-red-600/40 text-sm font-medium px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Value"
            value={`$${fmtPrice(bot ? bot.virtual_balance + (perf?.current_position ? 0 : 0) : 0)}`}
            sub={`Initial: $${fmtPrice(bot?.initial_balance)}`}
          />
          <StatCard
            label="PnL"
            value={`${perf ? (perf.total_pnl_pct >= 0 ? '+' : '') + perf.total_pnl_pct.toFixed(2) : '—'}%`}
            sub={perf ? `$${fmtPrice(perf.total_pnl_usdt)} USDT` : undefined}
            colour={pnlColour(perf?.total_pnl_pct)}
          />
          <StatCard
            label="Win Rate"
            value={perf ? `${(perf.win_rate * 100).toFixed(1)}%` : '—'}
            sub={perf ? `${perf.winning_trades}/${perf.total_trades} trades` : undefined}
          />
          <StatCard
            label="Sharpe"
            value={perf ? perf.sharpe_ratio.toFixed(2) : '—'}
            sub={perf ? `Max DD: ${perf.max_drawdown_pct.toFixed(2)}%` : undefined}
            colour={
              perf
                ? perf.sharpe_ratio >= 1
                  ? 'text-green-400'
                  : perf.sharpe_ratio >= 0
                  ? 'text-yellow-400'
                  : 'text-red-400'
                : undefined
            }
          />
        </div>

        {/* Debug Info */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Debug Informationen</h2>
            <span className="text-xs text-slate-500">Live polling: 60s</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Time online (seit updated_at)</p>
              <p className="text-sm text-white font-medium">{fmtDurationSince(bot?.updated_at)}</p>
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Signals (geladen)</p>
              <p className="text-sm text-white font-medium">{signals.length}</p>
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Trades (geladen)</p>
              <p className="text-sm text-white font-medium">{trades.length}</p>
            </div>
            <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Letzter Snapshot</p>
              <p className="text-sm text-white font-medium">{lastSnapshot ? fmtDate(lastSnapshot.timestamp) : '—'}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-400 mb-2">Aktive Bot-Config</p>
              <pre className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 overflow-x-auto">
{JSON.stringify(config, null, 2)}
              </pre>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-slate-400">Signal / Runner Status</p>
              <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 text-xs text-slate-300 space-y-1">
                <p>Status: <span className="text-white">{bot?.status ?? '—'}</span></p>
                <p>Timeframe: <span className="text-white">{String(config.timeframe ?? '—')}</span></p>
                <p>RSI period: <span className="text-white">{String(config.period ?? '—')}</span></p>
                <p>Oversold / Overbought: <span className="text-white">{String(config.oversold ?? '—')} / {String(config.overbought ?? '—')}</span></p>
                <p>Last Signal: <span className="text-white">{lastSignal ? `${lastSignal.action.toUpperCase()} @ ${fmtDate(lastSignal.timestamp)}` : 'none'}</span></p>
              </div>
              {debugHint && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
                  {debugHint}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Equity Curve */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Equity Curve</h2>
            <span className="text-xs text-slate-500">
              Kumulierter PnL seit Start
            </span>
          </div>
          <EquityCurve
            botId={botId}
            initialBalance={bot?.initial_balance ?? 10000}
            onSnapshotsLoaded={setSharedSnapshots}
          />
        </div>

        {/* Drawdown Chart */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-semibold">Drawdown</h2>
            <span className="text-xs text-slate-500">
              Verlust vom Höchststand
            </span>
          </div>
          <DrawdownChart snapshots={sharedSnapshots.length > 0 ? sharedSnapshots : snapshots} />
        </div>

        {/* Recent Trades */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-white font-semibold">
              Recent Trades
              {tradesQuery.data ? (
                <span className="text-slate-500 font-normal text-sm ml-2">
                  ({tradesQuery.data.total} total)
                </span>
              ) : null}
            </h2>
          </div>
          {tradesQuery.isLoading ? (
            <div className="py-8 text-center text-slate-500 text-sm">Loading trades…</div>
          ) : trades.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">No trades yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wider">
                    <th className="text-left px-5 py-3 font-medium">Time</th>
                    <th className="text-left px-5 py-3 font-medium">Action</th>
                    <th className="text-right px-5 py-3 font-medium">Price</th>
                    <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Qty</th>
                    <th className="text-right px-5 py-3 font-medium hidden md:table-cell">Value</th>
                    <th className="text-right px-5 py-3 font-medium">PnL</th>
                    <th className="text-left px-5 py-3 font-medium hidden lg:table-cell">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {trades.map((trade) => (
                    <tr key={trade.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {fmtDate(trade.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            trade.action === 'buy'
                              ? 'bg-green-600/20 text-green-400'
                              : 'bg-red-600/20 text-red-400'
                          }`}
                        >
                          {trade.action.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-white font-mono text-xs">
                        ${fmtPrice(trade.price)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400 font-mono text-xs hidden sm:table-cell">
                        {trade.quantity.toFixed(6)}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400 font-mono text-xs hidden md:table-cell">
                        ${fmtPrice(trade.value_usdt)}
                      </td>
                      <td className={`px-5 py-3 text-right font-mono text-xs ${pnlColour(trade.pnl_pct)}`}>
                        {trade.pnl_pct != null
                          ? `${trade.pnl_pct >= 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td
                        className="px-5 py-3 text-slate-500 text-xs hidden lg:table-cell max-w-xs truncate"
                        title={trade.signal_reason ?? ''}
                      >
                        {truncate(trade.signal_reason ?? '')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Signal Log */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="text-white font-semibold">
              Signal Log
              {signalsQuery.data ? (
                <span className="text-slate-500 font-normal text-sm ml-2">
                  ({signalsQuery.data.total} total)
                </span>
              ) : null}
            </h2>
          </div>
          {signalsQuery.isLoading ? (
            <div className="py-8 text-center text-slate-500 text-sm">Loading signals…</div>
          ) : signals.length === 0 ? (
            <div className="py-8 text-center text-slate-500 text-sm">No signals yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wider">
                    <th className="text-left px-5 py-3 font-medium">Time</th>
                    <th className="text-left px-5 py-3 font-medium">Signal</th>
                    <th className="text-right px-5 py-3 font-medium">RSI</th>
                    <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Confidence</th>
                    <th className="text-left px-5 py-3 font-medium hidden md:table-cell">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {signals.map((sig) => (
                    <tr key={sig.id} className="hover:bg-slate-700/30 transition-colors">
                      <td className="px-5 py-3 text-slate-400 text-xs whitespace-nowrap">
                        {fmtDate(sig.timestamp)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            sig.action === 'buy'
                              ? 'bg-green-600/20 text-green-400'
                              : sig.action === 'sell'
                              ? 'bg-red-600/20 text-red-400'
                              : 'bg-slate-600/30 text-slate-400'
                          }`}
                        >
                          {sig.action.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono text-xs text-slate-300">
                        {sig.rsi_value != null ? sig.rsi_value.toFixed(1) : '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-400 text-xs hidden sm:table-cell">
                        {(sig.confidence * 100).toFixed(0)}%
                      </td>
                      <td
                        className="px-5 py-3 text-slate-500 text-xs hidden md:table-cell max-w-xs truncate"
                        title={sig.reason}
                      >
                        {truncate(sig.reason)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
