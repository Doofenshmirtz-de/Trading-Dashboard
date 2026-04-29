import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchBots, createBot, updateBot, deleteBot } from '../lib/api'
import { StatusBadge } from '../components/ui/StatusBadge'
import { useToast } from '../components/ui/Toast'
import type { Bot, CreateBotRequest, BotStatus } from '../types'

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
  copy_trading: { trader_id: '' },
  ml: { model_name: '' },
  custom: {},
}

const EMPTY_FORM: CreateBotRequest = {
  name: '',
  type: 'rule_based',
  config: DEFAULT_CONFIGS.rule_based,
  virtual_balance: 10000,
  initial_balance: 10000,
  trading_pair: 'BTC/USDT:USDT',
}

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

              {/* RSI Strategy Config — only shown for rule_based */}
              {form.type === 'rule_based' && (
                <div className="border border-slate-600 rounded-xl p-4 space-y-3">
                  <p className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                    RSI Strategy Config
                  </p>
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
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Period
                        <span className="text-slate-500 ml-1 normal-case">(RSI look-back)</span>
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
                    {' '}Ticks every <strong className="text-slate-400">{String((form.config as Record<string, unknown>).timeframe ?? '1h')}</strong>.
                    {' '}Use <strong className="text-slate-400">1m</strong> for fast testing.
                  </p>
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
