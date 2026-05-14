import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { runBacktest, fetchBacktestResults, deleteBacktestResult } from '../lib/api'
import type { BacktestRequest, BacktestResult, BacktestSummary } from '../types'

// ── Constants ──────────────────────────────────────────────────────────────────

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d']
const INDICATORS = ['RSI', 'MACD', 'BB'] as const
type Indicator = typeof INDICATORS[number]

const DEFAULT_CONFIGS: Record<Indicator, Record<string, unknown>> = {
  RSI: { indicator: 'RSI', timeframe: '1h', period: 14, oversold: 30, overbought: 70 },
  MACD: { indicator: 'MACD', timeframe: '1h', fast_period: 12, slow_period: 26, signal_period: 9 },
  BB: { indicator: 'BB', timeframe: '1h', period: 20, std_dev: 2.0 },
}

function defaultFrom(): string {
  const d = new Date()
  d.setMonth(d.getMonth() - 3)
  return d.toISOString().slice(0, 10)
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean | null
}) {
  const color =
    positive === true
      ? 'text-emerald-400'
      : positive === false
        ? 'text-red-400'
        : 'text-white'

  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-slate-500 text-xs mt-0.5">{sub}</p>}
    </div>
  )
}

function ConfigFields({
  indicator,
  config,
  onChange,
}: {
  indicator: Indicator
  config: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
}) {
  function numField(key: string, label: string, min: number, max: number, step = 1) {
    return (
      <div key={key}>
        <label className="block text-xs text-slate-400 mb-1">{label}</label>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={config[key] as number ?? ''}
          onChange={(e) => onChange(key, Number(e.target.value))}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
    )
  }

  if (indicator === 'RSI') {
    return (
      <div className="grid grid-cols-3 gap-3">
        {numField('period', 'Period', 2, 100)}
        {numField('oversold', 'Oversold', 10, 45)}
        {numField('overbought', 'Overbought', 55, 90)}
      </div>
    )
  }

  if (indicator === 'MACD') {
    return (
      <div className="grid grid-cols-3 gap-3">
        {numField('fast_period', 'Fast EMA', 2, 50)}
        {numField('slow_period', 'Slow EMA', 5, 200)}
        {numField('signal_period', 'Signal', 2, 50)}
      </div>
    )
  }

  if (indicator === 'BB') {
    return (
      <div className="grid grid-cols-2 gap-3">
        {numField('period', 'Period', 5, 200)}
        {numField('std_dev', 'Std Dev', 0.5, 5, 0.1)}
      </div>
    )
  }

  return null
}

function EquityCurveChart({ data, initialBalance }: { data: { timestamp: number; value: number }[]; initialBalance: number }) {
  const chartData = data.map((p) => ({
    ts: new Date(p.timestamp).toLocaleDateString('de-DE', { month: 'short', day: 'numeric' }),
    value: p.value,
  }))

  const values = data.map((p) => p.value)
  const minV = Math.min(...values)
  const maxV = Math.max(...values)
  const padding = (maxV - minV) * 0.05 || 100
  const lastValue = values.length > 0 ? values[values.length - 1] : initialBalance
  const isPositive = lastValue >= initialBalance

  const formatY = (v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 16, bottom: 0 }}>
        <defs>
          <linearGradient id="btGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0.25} />
            <stop offset="95%" stopColor={isPositive ? '#10b981' : '#ef4444'} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="ts"
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          interval={Math.max(1, Math.floor(chartData.length / 8))}
          minTickGap={50}
        />
        <YAxis
          tick={{ fill: '#94a3b8', fontSize: 11 }}
          tickFormatter={formatY}
          domain={[minV - padding, maxV + padding]}
          width={75}
        />
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          labelStyle={{ color: '#94a3b8' }}
          formatter={(v: unknown) => [`$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`, 'Kapital']}
        />
        <ReferenceLine y={initialBalance} stroke="#64748b" strokeDasharray="4 4" />
        <Area
          type="monotone"
          dataKey="value"
          stroke={isPositive ? '#10b981' : '#ef4444'}
          strokeWidth={2}
          fill="url(#btGrad)"
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function HistoryRow({
  run,
  onLoad,
  onDelete,
}: {
  run: BacktestSummary
  onLoad: () => void
  onDelete: () => void
}) {
  const pnl = run.pnl_pct ?? 0
  const isPos = pnl >= 0

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-750 transition-colors">
      <td className="py-2 px-3 text-sm text-white font-medium truncate max-w-[180px]">{run.name}</td>
      <td className="py-2 px-3 text-xs text-slate-300">{run.pair}</td>
      <td className="py-2 px-3 text-xs text-slate-300">{run.timeframe}</td>
      <td className={`py-2 px-3 text-sm font-semibold ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
        {isPos ? '+' : ''}{pnl.toFixed(2)}%
      </td>
      <td className="py-2 px-3 text-xs text-slate-300">{run.total_trades ?? '—'}</td>
      <td className="py-2 px-3 text-xs text-slate-300">{run.win_rate != null ? `${(run.win_rate * 100).toFixed(0)}%` : '—'}</td>
      <td className="py-2 px-3 text-xs text-slate-400">
        {new Date(run.created_at).toLocaleDateString('de-DE')}
      </td>
      <td className="py-2 px-3">
        <div className="flex gap-2">
          <button
            onClick={onLoad}
            className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            Laden
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-slate-500 hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function BacktestPage() {
  const queryClient = useQueryClient()

  // Form state
  const [indicator, setIndicator] = useState<Indicator>('RSI')
  const [pair, setPair] = useState('BTC/USDT:USDT')
  const [timeframe, setTimeframe] = useState('1h')
  const [fromDate, setFromDate] = useState(defaultFrom)
  const [toDate, setToDate] = useState(defaultTo)
  const [initialBalance, setInitialBalance] = useState(10000)
  const [name, setName] = useState('')
  const [config, setConfig] = useState<Record<string, unknown>>(DEFAULT_CONFIGS['RSI'])

  // Active result (from run or history load)
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(null)

  const updateConfig = (key: string, value: unknown) => setConfig((prev) => ({ ...prev, [key]: value }))

  function handleIndicatorChange(ind: Indicator) {
    setIndicator(ind)
    setConfig({ ...DEFAULT_CONFIGS[ind], timeframe })
  }

  function handleTimeframeChange(tf: string) {
    setTimeframe(tf)
    setConfig((prev) => ({ ...prev, timeframe: tf }))
  }

  // Mutations
  const { mutate: doRun, isPending: isRunning, error: runError } = useMutation({
    mutationFn: (req: BacktestRequest) => runBacktest(req),
    onSuccess: (result) => {
      setActiveResult(result)
      queryClient.invalidateQueries({ queryKey: ['backtest-results'] })
    },
  })

  const { mutate: doDelete } = useMutation({
    mutationFn: deleteBacktestResult,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['backtest-results'] }),
  })

  // History
  const { data: historyData } = useQuery({
    queryKey: ['backtest-results'],
    queryFn: () => fetchBacktestResults(20),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    doRun({
      name,
      pair: pair.trim(),
      timeframe,
      from_date: fromDate,
      to_date: toDate,
      initial_balance: initialBalance,
      config: { ...config, indicator, timeframe },
    })
  }

  const errMsg = runError instanceof Error ? runError.message : null

  const metrics = activeResult?.metrics
  const pnlPositive = metrics ? metrics.pnl_pct >= 0 : null

  const tradeRows = useMemo(
    () => (activeResult?.trades ?? []).slice().reverse(),
    [activeResult],
  )

  return (
    <div className="pt-16 min-h-screen bg-slate-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Backtesting</h1>
          <p className="text-slate-400 text-sm mt-1">
            Strategien gegen historische Binance-Daten testen
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* ── Left: Form ─────────────────────────────────────────────────── */}
          <div className="xl:col-span-1">
            <form
              onSubmit={handleSubmit}
              className="bg-slate-800 rounded-xl border border-slate-700 p-5 space-y-4"
            >
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Konfiguration
              </h2>

              {/* Name */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name (optional)</label>
                <input
                  type="text"
                  placeholder="z.B. RSI BTC 1h Q1 2024"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Indicator */}
              <div>
                <label className="block text-xs text-slate-400 mb-2">Indikator</label>
                <div className="flex gap-2">
                  {INDICATORS.map((ind) => (
                    <button
                      key={ind}
                      type="button"
                      onClick={() => handleIndicatorChange(ind)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        indicator === ind
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {ind}
                    </button>
                  ))}
                </div>
              </div>

              {/* Config fields */}
              <ConfigFields indicator={indicator} config={config} onChange={updateConfig} />

              {/* Pair */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Pair <span className="text-slate-600">(Format: BTC/USDT:USDT)</span>
                </label>
                <input
                  type="text"
                  value={pair}
                  onChange={(e) => setPair(e.target.value)}
                  required
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Timeframe */}
              <div>
                <label className="block text-xs text-slate-400 mb-2">Timeframe</label>
                <div className="flex flex-wrap gap-1.5">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      type="button"
                      onClick={() => handleTimeframeChange(tf)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        timeframe === tf
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Von</label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Bis</label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    required
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Initial balance */}
              <div>
                <label className="block text-xs text-slate-400 mb-1">Startkapital (USDT)</label>
                <input
                  type="number"
                  min={100}
                  max={1_000_000}
                  step={100}
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(Number(e.target.value))}
                  required
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Error */}
              {errMsg && (
                <div className="bg-red-900/40 border border-red-700 rounded-lg px-3 py-2 text-red-300 text-sm">
                  {errMsg}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isRunning}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:text-blue-400 text-white font-semibold rounded-lg py-2.5 text-sm transition-colors"
              >
                {isRunning ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Lädt Kerzen & simuliert…
                  </span>
                ) : (
                  '▶ Backtest starten'
                )}
              </button>
            </form>
          </div>

          {/* ── Right: Results ────────────────────────────────────────────── */}
          <div className="xl:col-span-2 space-y-6">
            {activeResult ? (
              <>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-white">{activeResult.name}</h2>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {activeResult.pair} · {activeResult.timeframe} ·{' '}
                      {activeResult.candle_count.toLocaleString()} Kerzen ·{' '}
                      {activeResult.from_date} → {activeResult.to_date}
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveResult(null)}
                    className="text-slate-500 hover:text-slate-300 text-xl leading-none"
                    title="Ergebnis schließen"
                  >
                    ✕
                  </button>
                </div>

                {/* Metric cards */}
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <MetricCard
                    label="PnL %"
                    value={`${metrics!.pnl_pct >= 0 ? '+' : ''}${metrics!.pnl_pct.toFixed(2)}%`}
                    sub={`${metrics!.pnl_usdt >= 0 ? '+' : ''}$${metrics!.pnl_usdt.toFixed(2)}`}
                    positive={pnlPositive}
                  />
                  <MetricCard
                    label="Win Rate"
                    value={`${(metrics!.win_rate * 100).toFixed(0)}%`}
                    sub={`${metrics!.winning_trades}W / ${metrics!.losing_trades}L`}
                    positive={metrics!.win_rate >= 0.5 ? true : metrics!.win_rate < 0.4 ? false : null}
                  />
                  <MetricCard
                    label="Trades"
                    value={String(metrics!.total_trades)}
                  />
                  <MetricCard
                    label="Max DD"
                    value={`-${metrics!.max_drawdown_pct.toFixed(2)}%`}
                    positive={metrics!.max_drawdown_pct < 10 ? true : metrics!.max_drawdown_pct > 25 ? false : null}
                  />
                  <MetricCard
                    label="Sharpe"
                    value={metrics!.sharpe_ratio.toFixed(2)}
                    positive={metrics!.sharpe_ratio > 1 ? true : metrics!.sharpe_ratio < 0 ? false : null}
                  />
                </div>

                {/* Equity Curve */}
                <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                  <h3 className="text-sm font-semibold text-slate-300 mb-4">Equity Curve</h3>
                  {activeResult.equity_curve.length > 1 ? (
                    <EquityCurveChart
                      data={activeResult.equity_curve}
                      initialBalance={activeResult.initial_balance}
                    />
                  ) : (
                    <p className="text-slate-500 text-sm text-center py-8">
                      Nicht genug Datenpunkte für Chart
                    </p>
                  )}
                </div>

                {/* Trade Log */}
                {tradeRows.length > 0 && (
                  <div className="bg-slate-800 rounded-xl border border-slate-700 p-5">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">
                      Letzte Trades ({activeResult.trades.length})
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-xs text-slate-500 uppercase border-b border-slate-700">
                            <th className="text-left py-2 px-3">Datum</th>
                            <th className="text-left py-2 px-3">Aktion</th>
                            <th className="text-right py-2 px-3">Preis</th>
                            <th className="text-right py-2 px-3">PnL %</th>
                            <th className="text-left py-2 px-3 hidden lg:table-cell">Grund</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tradeRows.slice(0, 50).map((t, i) => (
                            <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                              <td className="py-1.5 px-3 text-slate-400 text-xs">
                                {new Date(t.timestamp).toLocaleDateString('de-DE')}
                              </td>
                              <td className="py-1.5 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                                    t.action === 'buy'
                                      ? 'bg-emerald-900/50 text-emerald-400'
                                      : 'bg-red-900/50 text-red-400'
                                  }`}
                                >
                                  {t.action.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-1.5 px-3 text-right text-slate-200 font-mono text-xs">
                                ${t.price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                              </td>
                              <td className="py-1.5 px-3 text-right font-mono text-xs">
                                {t.pnl_pct != null ? (
                                  <span className={t.pnl_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                    {t.pnl_pct >= 0 ? '+' : ''}{t.pnl_pct.toFixed(3)}%
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                              <td className="py-1.5 px-3 text-slate-500 text-xs truncate max-w-[200px] hidden lg:table-cell">
                                {t.reason || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-slate-800 rounded-xl border border-slate-700 p-12 flex flex-col items-center justify-center text-center">
                <div className="text-5xl mb-4">📊</div>
                <p className="text-slate-300 font-medium">Kein Backtest aktiv</p>
                <p className="text-slate-500 text-sm mt-1">
                  Konfiguration links ausfüllen und "Backtest starten" klicken
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── History ───────────────────────────────────────────────────────────── */}
        {historyData && historyData.results.length > 0 && (
          <div className="mt-8 bg-slate-800 rounded-xl border border-slate-700 p-5">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-4">
              Verlauf ({historyData.results.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-slate-500 uppercase border-b border-slate-700">
                    <th className="text-left py-2 px-3">Name</th>
                    <th className="text-left py-2 px-3">Pair</th>
                    <th className="text-left py-2 px-3">TF</th>
                    <th className="text-left py-2 px-3">PnL %</th>
                    <th className="text-left py-2 px-3">Trades</th>
                    <th className="text-left py-2 px-3">Win %</th>
                    <th className="text-left py-2 px-3">Datum</th>
                    <th className="py-2 px-3" />
                  </tr>
                </thead>
                <tbody>
                  {historyData.results.map((run) => (
                    <HistoryRow
                      key={run.id}
                      run={run}
                      onLoad={async () => {
                        const { fetchBacktestResult } = await import('../lib/api')
                        const full = await fetchBacktestResult(run.id)
                        setActiveResult(full)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      onDelete={() => doDelete(run.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
