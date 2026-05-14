import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchBots, createBot, updateBot, deleteBot, fetchCopyLeaders } from '../lib/api'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useToast } from '../components/ui/Toast'
import type { Bot, CreateBotRequest, BotStatus, CopyLeader } from '../types'

const PAGE_SIZE = 10

const ALLOWED_TRANSITIONS: Record<BotStatus, BotStatus[]> = {
  stopped: ['running'],
  running: ['paused', 'stopped'],
  paused: ['running', 'stopped'],
}

function getNextAction(
  status: BotStatus,
): { label: string; next: BotStatus } | null {
  if (status === 'stopped' || status === 'paused') {
    return { label: 'Start', next: 'running' }
  }
  if (status === 'running') {
    return { label: 'Stop', next: 'stopped' }
  }
  return null
}

const DEFAULT_CONFIGS: Record<string, Record<string, unknown>> = {
  rule_based: { indicator: 'RSI', timeframe: '1h', period: 14, oversold: 30, overbought: 70 },
  copy_trading: {
    leader_portfolio_id: '',
    timeframe: '1m',
    stop_loss_pct: 5,
    take_profit_pct: 10,
    max_daily_loss_pct: 15,
    position_size_pct: 95,
  },
  ml: { model_name: '' },
  custom: {},
}

const RSI_CONFIG = {
  indicator: 'RSI',
  timeframe: '1h',
  period: 14,
  oversold: 30,
  overbought: 70,
}

const MACD_CONFIG = {
  indicator: 'MACD',
  timeframe: '1h',
  fast_period: 12,
  slow_period: 26,
  signal_period: 9,
}

const BOLLINGER_CONFIG = {
  indicator: 'BOLLINGER',
  timeframe: '1h',
  period: 20,
  std_dev_multiplier: 2.0,
}

type IndicatorType = 'RSI' | 'MACD' | 'BOLLINGER'

const EMPTY_FORM: CreateBotRequest = {
  name: '',
  type: 'rule_based',
  config: DEFAULT_CONFIGS.rule_based,
  virtual_balance: 10000,
  initial_balance: 10000,
  trading_pair: 'BTC/USDT:USDT',
}

// ── CopyTradingConfig sub-component ───────────────────────────────────────────

type CopyTab = 'browse' | 'manual'
type SortBy = 'ROI' | 'PNL'
type Period = 'WEEKLY' | 'MONTHLY' | 'ALL'

function CopyTradingConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (updated: Record<string, unknown>) => void
}) {
  const [tab, setTab] = useState<CopyTab>('browse')
  const [sortBy, setSortBy] = useState<SortBy>('ROI')
  const [period, setPeriod] = useState<Period>('MONTHLY')
  const [selectedId, setSelectedId] = useState<string>(
    String(config.leader_portfolio_id ?? ''),
  )

  const { data, isLoading, isError } = useQuery({
    queryKey: ['copy-leaders', sortBy, period],
    queryFn: () => fetchCopyLeaders(sortBy, period, 20),
    staleTime: 5 * 60 * 1000,
  })

  function selectLeader(leader: CopyLeader) {
    setSelectedId(leader.portfolio_id)
    onChange({
      ...config,
      leader_portfolio_id: leader.portfolio_id,
      _leader_name: leader.nick_name,
    })
  }

  function pickRandom() {
    const leaders = data?.leaders ?? []
    if (!leaders.length) return
    const pick = leaders[Math.floor(Math.random() * leaders.length)]
    selectLeader(pick)
  }

  const selectedLeader = data?.leaders.find((l) => l.portfolio_id === selectedId)

  return (
    <div className="border border-amber-700/50 bg-amber-900/10 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-amber-400">🔗</span>
          <p className="text-xs text-amber-300 uppercase tracking-wider font-semibold">
            Copy Trading — Lead Trader auswählen
          </p>
        </div>
        {selectedId && (
          <span className="text-xs bg-emerald-900/50 text-emerald-400 border border-emerald-700/50 px-2 py-0.5 rounded-full">
            ✓ {selectedLeader?.nick_name ?? selectedId.slice(0, 8) + '…'}
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-slate-900/50 p-0.5 rounded-lg w-fit">
        {(['browse', 'manual'] as CopyTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {t === 'browse' ? '🔍 Durchsuchen' : '✏️ Manuell'}
          </button>
        ))}
      </div>

      {/* Browse tab */}
      {tab === 'browse' && (
        <div className="space-y-3">
          {/* Filters + Random */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Sortieren:</span>
            {(['ROI', 'PNL'] as SortBy[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSortBy(s)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  sortBy === s
                    ? 'bg-amber-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {s === 'ROI' ? 'ROI %' : 'PnL $'}
              </button>
            ))}
            <span className="text-slate-600 text-xs">|</span>
            {(['WEEKLY', 'MONTHLY', 'ALL'] as Period[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                  period === p
                    ? 'bg-slate-600 text-white'
                    : 'bg-slate-700 text-slate-400 hover:text-white'
                }`}
              >
                {p === 'WEEKLY' ? '7T' : p === 'MONTHLY' ? '30T' : 'Alle'}
              </button>
            ))}
            <button
              type="button"
              onClick={pickRandom}
              disabled={isLoading || !data?.leaders.length}
              className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-700/60 hover:bg-purple-600 text-purple-200 disabled:opacity-40 transition-colors"
            >
              🎲 Zufällig
            </button>
          </div>

          {/* Leader list */}
          {isLoading && (
            <div className="text-center py-6 text-slate-500 text-sm">
              <svg className="animate-spin h-5 w-5 mx-auto mb-2 text-amber-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Lade Leaderboard…
            </div>
          )}
          {isError && (
            <div className="text-center py-4 text-amber-600 text-xs">
              Binance Leaderboard nicht verfügbar — bitte manuell eingeben.
            </div>
          )}
          {!isLoading && !isError && (
            <div className="overflow-y-auto max-h-56 rounded-lg border border-slate-700 divide-y divide-slate-700/50">
              {(data?.leaders ?? []).length === 0 ? (
                <p className="text-center py-4 text-slate-500 text-xs">Keine Trader gefunden</p>
              ) : (
                (data?.leaders ?? []).map((leader) => {
                  const isSelected = leader.portfolio_id === selectedId
                  return (
                    <button
                      key={leader.portfolio_id}
                      type="button"
                      onClick={() => selectLeader(leader)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        isSelected
                          ? 'bg-amber-900/40 border-l-2 border-amber-500'
                          : 'hover:bg-slate-700/50'
                      }`}
                    >
                      {/* Name */}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-medium text-white truncate">
                          {leader.nick_name}
                          {!leader.position_shared && (
                            <span className="ml-1.5 text-xs text-slate-500">(privat)</span>
                          )}
                        </span>
                        <span className="text-xs text-slate-500">
                          {leader.follower_count.toLocaleString()} Follower
                        </span>
                      </span>
                      {/* Stats */}
                      <div className="flex gap-4 shrink-0 text-right">
                        <div>
                          <p className={`text-sm font-bold ${leader.roi >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {leader.roi >= 0 ? '+' : ''}{leader.roi.toFixed(1)}%
                          </p>
                          <p className="text-xs text-slate-500">ROI</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-white">{leader.win_rate.toFixed(0)}%</p>
                          <p className="text-xs text-slate-500">Win</p>
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-red-400">-{leader.max_drawdown.toFixed(1)}%</p>
                          <p className="text-xs text-slate-500">MaxDD</p>
                        </div>
                      </div>
                      {isSelected && <span className="text-amber-400 text-sm shrink-0">✓</span>}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Manual tab */}
      {tab === 'manual' && (
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Portfolio ID
            <span className="text-slate-500 ml-1 normal-case">
              (aus Binance URL: /copy-trading/lead-trader/
              <span className="text-amber-500">XXXXXXXX</span>)
            </span>
          </label>
          <input
            value={String(config.leader_portfolio_id ?? '')}
            onChange={(e) => {
              setSelectedId(e.target.value)
              onChange({ ...config, leader_portfolio_id: e.target.value })
            }}
            placeholder="z.B. 3953748A4FE10DFA97B2E5A5E4641B82"
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {/* Timeframe */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">
          Tick-Intervall
          <span className="text-slate-500 ml-1 normal-case">(1m empfohlen)</span>
        </label>
        <select
          value={String(config.timeframe ?? '1m')}
          onChange={(e) => onChange({ ...config, timeframe: e.target.value })}
          className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
        >
          <option value="1m">1m — empfohlen</option>
          <option value="5m">5m</option>
          <option value="15m">15m</option>
          <option value="1h">1h</option>
        </select>
      </div>

      {/* Risk controls */}
      <div className="pt-3 border-t border-slate-700 space-y-3">
        <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">Risiko-Kontrolle</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { key: 'stop_loss_pct', label: 'Stop-Loss %', sub: 'Auto-Close bei Verlust', def: 5, min: 0.1, max: 50, step: 0.5 },
            { key: 'take_profit_pct', label: 'Take-Profit %', sub: 'Auto-Close bei Gewinn', def: 10, min: 0.1, max: 200, step: 0.5 },
            { key: 'max_daily_loss_pct', label: 'Max. Tages-Verlust %', sub: 'Pause nach X%/Tag', def: 15, min: 1, max: 100, step: 1 },
          ].map(({ key, label, sub, def, min, max, step }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">
                {label}
                <span className="text-slate-600 ml-1 normal-case">({sub})</span>
              </label>
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={Number(config[key] ?? def)}
                onChange={(e) => onChange({ ...config, [key]: Number(e.target.value) })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-amber-700/80 bg-amber-900/20 border border-amber-800/40 rounded-lg px-3 py-2">
          ⚠️ Der Bot spiegelt nur Positionen auf dem konfigurierten Pair. Trader müssen öffentliche Positionen auf Binance freigegeben haben.
        </p>
      </div>
    </div>
  )
}

// ── BotsPage ───────────────────────────────────────────────────────────────────

export function BotsPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { show } = useToast()
  const [page, setPage] = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateBotRequest>(EMPTY_FORM)

  const offset = page * PAGE_SIZE
  const { data, isLoading } = useQuery({
    queryKey: ['bots', PAGE_SIZE, offset],
    queryFn: () => fetchBots(PAGE_SIZE, offset),
  })

  const createMutation = useMutation({
    mutationFn: createBot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bots'] })
      setShowCreate(false)
      setForm(EMPTY_FORM)
      show('Bot created successfully', 'success')
    },
    onError: (err: Error & { status?: number }) => {
      show(err.message || 'Failed to create bot', 'error')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<{ status: BotStatus }> }) =>
      updateBot(id, data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bots'] })
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 422) {
        show('Cannot start this bot from its current state', 'error')
      } else {
        show(err.message || 'Failed to update bot', 'error')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bots'] })
      show('Bot deleted', 'info')
    },
    onError: (err: Error) => show(err.message || 'Failed to delete bot', 'error'),
  })

  function handleStatusToggle(bot: Bot) {
    const action = getNextAction(bot.status)
    if (!action) return
    if (!ALLOWED_TRANSITIONS[bot.status].includes(action.next)) {
      show('Cannot start this bot from its current state', 'error')
      return
    }
    updateMutation.mutate({ id: bot.id, data: { status: action.next } })
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    createMutation.mutate(form)
  }

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE)

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Trading Bots</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {data?.total ?? 0} bot{data?.total !== 1 ? 's' : ''} total
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
          >
            + New Bot
          </button>
        </div>

        {/* Create form */}
        {showCreate && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
            <h2 className="text-white font-semibold mb-4">Create New Bot</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Name</label>
                  <input
                    required
                    minLength={3}
                    maxLength={64}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    placeholder="My RSI Bot"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => {
                      const t = e.target.value as CreateBotRequest['type']
                      setForm({ ...form, type: t, config: DEFAULT_CONFIGS[t] ?? {} })
                    }}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="rule_based">Rule Based (RSI)</option>
                    <option value="copy_trading">Copy Trading</option>
                    <option value="ml">Machine Learning</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Trading Pair</label>
                  <input
                    value={form.trading_pair}
                    onChange={(e) => setForm({ ...form, trading_pair: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                    placeholder="BTC/USDT:USDT"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">Virtual Balance (USDT)</label>
                  <input
                    type="number"
                    min={100}
                    value={form.virtual_balance}
                    onChange={(e) =>
                      setForm({ ...form, virtual_balance: Number(e.target.value) })
                    }
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Copy Trading Config */}
              {form.type === 'copy_trading' && (
                <CopyTradingConfig
                  config={form.config as Record<string, unknown>}
                  onChange={(updated) => setForm({ ...form, config: updated })}
                />
              )}

              {/* Indicator Selection & Config — only shown for rule_based */}
              {form.type === 'rule_based' && (
                <div className="border border-slate-600 rounded-xl p-4 space-y-4">
                  {/* Indicator Selector */}
                  <div>
                    <label className="block text-xs text-slate-400 uppercase tracking-wider font-medium mb-2">
                      Indikator
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(['RSI', 'MACD', 'BOLLINGER'] as IndicatorType[]).map((ind) => (
                        <button
                          key={ind}
                          type="button"
                          onClick={() => {
                            let newConfig
                            switch (ind) {
                              case 'RSI':
                                newConfig = { ...RSI_CONFIG }
                                break
                              case 'MACD':
                                newConfig = { ...MACD_CONFIG }
                                break
                              case 'BOLLINGER':
                                newConfig = { ...BOLLINGER_CONFIG }
                                break
                            }
                            setForm({ ...form, config: newConfig })
                          }}
                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            (form.config as Record<string, unknown>).indicator === ind
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600'
                          }`}
                        >
                          {ind === 'RSI' && 'RSI (Mean Reversion)'}
                          {ind === 'MACD' && 'MACD (Trend Following)'}
                          {ind === 'BOLLINGER' && 'Bollinger Bands (Mean Reversion)'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Timeframe Selection (common for all) */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Timeframe
                        <span className="text-slate-500 ml-1 normal-case">(candle interval)</span>
                      </label>
                      <select
                        value={String((form.config as Record<string, unknown>).timeframe ?? '1h')}
                        onChange={(e) =>
                          setForm({ ...form, config: { ...form.config, timeframe: e.target.value } })
                        }
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                      >
                        <option value="1m">1m — fast (testing)</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                        <option value="1h">1h — default</option>
                        <option value="4h">4h</option>
                        <option value="1d">1d — slow</option>
                      </select>
                    </div>
                  </div>

                  {/* RSI Config */}
                  {(form.config as Record<string, unknown>).indicator === 'RSI' && (
                    <div className="space-y-3 pt-3 border-t border-slate-700">
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                        RSI Einstellungen
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Period
                            <span className="text-slate-500 ml-1 normal-case">(Look-back)</span>
                          </label>
                          <input
                            type="number"
                            min={2}
                            max={100}
                            value={Number((form.config as Record<string, unknown>).period ?? 14)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, period: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Oversold
                            <span className="text-slate-500 ml-1 normal-case">(BUY below)</span>
                          </label>
                          <input
                            type="number"
                            min={10}
                            max={45}
                            value={Number((form.config as Record<string, unknown>).oversold ?? 30)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, oversold: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Overbought
                            <span className="text-slate-500 ml-1 normal-case">(SELL above)</span>
                          </label>
                          <input
                            type="number"
                            min={55}
                            max={90}
                            value={Number((form.config as Record<string, unknown>).overbought ?? 70)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, overbought: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        BUY when RSI crosses below <strong className="text-slate-400">{String((form.config as Record<string, unknown>).oversold ?? 30)}</strong>,
                        {' '}SELL when RSI crosses above <strong className="text-slate-400">{String((form.config as Record<string, unknown>).overbought ?? 70)}</strong>.
                        {' '}Best geeignet für: <span className="text-amber-400">Ranging Märkte</span>
                      </p>
                    </div>
                  )}

                  {/* MACD Config */}
                  {(form.config as Record<string, unknown>).indicator === 'MACD' && (
                    <div className="space-y-3 pt-3 border-t border-slate-700">
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                        MACD Einstellungen
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Fast Period
                            <span className="text-slate-500 ml-1 normal-case">(EMA)</span>
                          </label>
                          <input
                            type="number"
                            min={2}
                            max={50}
                            value={Number((form.config as Record<string, unknown>).fast_period ?? 12)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, fast_period: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Slow Period
                            <span className="text-slate-500 ml-1 normal-case">(EMA)</span>
                          </label>
                          <input
                            type="number"
                            min={5}
                            max={200}
                            value={Number((form.config as Record<string, unknown>).slow_period ?? 26)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, slow_period: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Signal Period
                            <span className="text-slate-500 ml-1 normal-case">(EMA)</span>
                          </label>
                          <input
                            type="number"
                            min={2}
                            max={50}
                            value={Number((form.config as Record<string, unknown>).signal_period ?? 9)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, signal_period: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        BUY wenn MACD Line über Signal Line kreuzt, SELL wenn darunter.
                        {' '}Standard: Fast={String((form.config as Record<string, unknown>).fast_period ?? 12)}/
                        Slow={String((form.config as Record<string, unknown>).slow_period ?? 26)}/
                        Signal={String((form.config as Record<string, unknown>).signal_period ?? 9)}.
                        {' '}Best geeignet für: <span className="text-emerald-400">Trending Märkte</span>
                      </p>
                    </div>
                  )}

                  {/* Bollinger Config */}
                  {(form.config as Record<string, unknown>).indicator === 'BOLLINGER' && (
                    <div className="space-y-3 pt-3 border-t border-slate-700">
                      <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                        Bollinger Bands Einstellungen
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Period
                            <span className="text-slate-500 ml-1 normal-case">(SMA)</span>
                          </label>
                          <input
                            type="number"
                            min={5}
                            max={100}
                            value={Number((form.config as Record<string, unknown>).period ?? 20)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, period: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">
                            Std Dev Multiplier
                            <span className="text-slate-500 ml-1 normal-case">(Bands)</span>
                          </label>
                          <input
                            type="number"
                            min={0.5}
                            max={5}
                            step={0.1}
                            value={Number((form.config as Record<string, unknown>).std_dev_multiplier ?? 2.0)}
                            onChange={(e) =>
                              setForm({ ...form, config: { ...form.config, std_dev_multiplier: Number(e.target.value) } })
                            }
                            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        BUY wenn Preis unter unteres Band fällt, SELL wenn über oberes Band steigt.
                        {' '}Period: {String((form.config as Record<string, unknown>).period ?? 20)},
                        {' '}Multiplier: {String((form.config as Record<string, unknown>).std_dev_multiplier ?? 2.0)}σ.
                        {' '}Best geeignet für: <span className="text-amber-400">Ranging Märkte</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
                >
                  {createMutation.isPending ? 'Creating…' : 'Create Bot'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreate(false)
                    setForm(EMPTY_FORM)
                  }}
                  className="text-slate-400 hover:text-white text-sm transition-colors px-3 py-2"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Bot list */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">Loading bots…</div>
          ) : !data?.bots.length ? (
            <div className="py-12 text-center">
              <p className="text-slate-500 text-sm mb-3">No bots yet</p>
              <button
                onClick={() => setShowCreate(true)}
                className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
              >
                Create your first bot →
              </button>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Name
                    </th>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider hidden sm:table-cell">
                      Type
                    </th>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider hidden md:table-cell">
                      Pair
                    </th>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Status
                    </th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {data.bots.map((bot) => {
                    const action = getNextAction(bot.status)
                    const indicator = (bot.config as Record<string, unknown>)?.indicator as string | undefined
                    return (
                      <tr key={bot.id} className="hover:bg-slate-700/50 transition-colors">
                        <td className="px-5 py-4">
                          <button
                            onClick={() => navigate(`/bots/${bot.id}`)}
                            className="text-left group"
                          >
                            <p className="text-white font-medium group-hover:text-blue-400 transition-colors">
                              {bot.name}
                            </p>
                            <p className="text-slate-500 text-xs mt-0.5">
                              {indicator ? `${indicator.toLowerCase()} • ` : ''}
                              ${bot.virtual_balance.toLocaleString()}
                            </p>
                          </button>
                        </td>
                        <td className="px-5 py-4 text-slate-400 hidden sm:table-cell">
                          {bot.type.replace('_', ' ')}
                        </td>
                        <td className="px-5 py-4 text-slate-400 font-mono text-xs hidden md:table-cell">
                          {bot.trading_pair}
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={bot.status} />
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {action && (
                              <button
                                onClick={() => handleStatusToggle(bot)}
                                disabled={updateMutation.isPending}
                                className={`text-xs font-medium px-3 py-1.5 rounded transition-colors disabled:opacity-50 ${
                                  action.next === 'running'
                                    ? 'bg-green-600/20 text-green-400 hover:bg-green-600/40'
                                    : 'bg-slate-600/40 text-slate-300 hover:bg-slate-600/60'
                                }`}
                              >
                                {action.label}
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (confirm(`Delete "${bot.name}"?`)) {
                                  deleteMutation.mutate(bot.id)
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="text-xs font-medium px-3 py-1.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition-colors disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700">
                  <p className="text-slate-500 text-xs">
                    Page {page + 1} of {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="text-xs text-slate-400 hover:text-white disabled:opacity-40 transition-colors px-3 py-1.5 rounded border border-slate-700 hover:border-slate-500"
                    >
                      Next →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
