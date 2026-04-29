export type BotType = 'rule_based' | 'copy_trading' | 'ml' | 'custom'
export type BotStatus = 'running' | 'paused' | 'stopped'

export interface Bot {
  id: string
  user_id: string
  name: string
  type: BotType
  status: BotStatus
  config: Record<string, unknown>
  virtual_balance: number
  initial_balance: number
  trading_pair: string
  created_at: string
  updated_at: string
}

export interface CreateBotRequest {
  name: string
  type: BotType
  config: Record<string, unknown>
  virtual_balance?: number
  initial_balance?: number
  trading_pair?: string
}

export interface UpdateBotRequest {
  name?: string
  status?: BotStatus
  config?: Record<string, unknown>
  trading_pair?: string
  virtual_balance?: number
}

export interface PaginatedBots {
  bots: Bot[]
  total: number
  limit: number
  offset: number
}

export interface TradingPair {
  symbol: string
  base: string
  quote: string
  active: boolean
}

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Ticker {
  symbol: string
  last: number | null
  change: number | null
  high: number | null
  low: number | null
  volume: number | null
}

export interface HealthService {
  connected: boolean
  latency_ms: number | null
  last_error: string | null
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error'
  environment: string
  services: {
    binance: HealthService
    supabase: HealthService
  }
}

export interface ApiError {
  status: number
  message: string
}

// ── Phase 3: Sandbox Engine types ─────────────────────────────────────────────

export type TradeAction = 'buy' | 'sell'
export type SignalAction = 'buy' | 'sell' | 'hold'

export interface Trade {
  id: string
  bot_id: string
  user_id: string
  action: TradeAction
  price: number
  quantity: number
  value_usdt: number
  fee_usdt: number
  pnl_usdt: number | null
  pnl_pct: number | null
  signal_reason: string | null
  confidence: number | null
  candle_timestamp: number | null
  created_at: string
}

export interface PaginatedTrades {
  trades: Trade[]
  total: number
}

export interface Snapshot {
  id: string
  bot_id: string
  timestamp: string
  virtual_balance: number
  position_value: number
  total_value: number
  pnl_pct: number
  btc_price: number | null
}

export interface SnapshotsResponse {
  snapshots: Snapshot[]
  bot: Bot
}

export interface BotSignal {
  id: string
  bot_id: string
  timestamp: string
  action: SignalAction
  confidence: number
  reason: string
  candle_close: number | null
  rsi_value: number | null
}

export interface SignalsResponse {
  signals: BotSignal[]
  total: number
}

export interface BotPerformance {
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number
  total_pnl_usdt: number
  total_pnl_pct: number
  best_trade_pct: number
  worst_trade_pct: number
  avg_trade_pct: number
  max_drawdown_pct: number
  sharpe_ratio: number
  current_position: Record<string, unknown> | null
  days_running: number
}
