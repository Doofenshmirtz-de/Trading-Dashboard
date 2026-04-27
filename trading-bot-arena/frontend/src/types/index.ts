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
