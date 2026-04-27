import { supabase } from './supabase'
import type {
  Bot,
  HealthResponse,
  TradingPair,
  Candle,
  Ticker,
  PaginatedBots,
  CreateBotRequest,
  UpdateBotRequest,
  ApiError,
} from '../types'

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

let _showToast: ((msg: string, type: 'success' | 'error' | 'info') => void) | null = null

export function registerToastCallback(
  fn: (msg: string, type: 'success' | 'error' | 'info') => void,
): void {
  _showToast = fn
}

function makeApiError(status: number, message: string): ApiError & Error {
  const err = new Error(message) as Error & ApiError
  err.status = status
  err.message = message
  return err
}

async function getAuthToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retries = 3,
): Promise<T> {
  const token = await getAuthToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  let lastError: ApiError & Error = makeApiError(0, 'Network error')

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${API_URL}${path}`, { ...options, headers })

      if (res.status === 401) {
        window.location.href = '/login'
        throw makeApiError(401, 'Unauthorized')
      }

      if (res.ok) {
        if (res.status === 204) return undefined as T
        return (await res.json()) as T
      }

      const body = await res.json().catch(() => ({ detail: res.statusText }))
      lastError = makeApiError(res.status, body.detail ?? res.statusText)

      if (res.status >= 500 && attempt < retries) {
        const delay = (attempt + 1) * 1000
        if (_showToast && attempt === 0) {
          _showToast('Service temporarily unavailable. Retrying...', 'error')
        }
        await sleep(delay)
        continue
      }

      throw lastError
    } catch (err) {
      if ((err as ApiError).status === 401) throw err
      if ((err as ApiError).status >= 400) throw err

      lastError = makeApiError(0, err instanceof Error ? err.message : 'Network error')
      if (attempt < retries) {
        const delay = (attempt + 1) * 1000
        await sleep(delay)
        continue
      }
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/health', {}, 0)
}

export function fetchPairs(): Promise<TradingPair[]> {
  return apiFetch<TradingPair[]>('/market/pairs')
}

export function fetchCandles(
  symbol: string,
  timeframe: string,
  limit = 100,
): Promise<Candle[]> {
  const params = new URLSearchParams({ symbol, timeframe, limit: String(limit) })
  return apiFetch<Candle[]>(`/market/candles?${params}`)
}

export function fetchTicker(symbol: string): Promise<Ticker> {
  return apiFetch<Ticker>(`/market/ticker?symbol=${encodeURIComponent(symbol)}`)
}

export function fetchBots(limit = 50, offset = 0): Promise<PaginatedBots> {
  return apiFetch<PaginatedBots>(`/bots?limit=${limit}&offset=${offset}`)
}

export function createBot(data: CreateBotRequest): Promise<Bot> {
  return apiFetch<Bot>('/bots', { method: 'POST', body: JSON.stringify(data) })
}

export function updateBot(id: string, data: Partial<UpdateBotRequest>): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export async function deleteBot(id: string): Promise<void> {
  await apiFetch<void>(`/bots/${id}`, { method: 'DELETE' })
}
