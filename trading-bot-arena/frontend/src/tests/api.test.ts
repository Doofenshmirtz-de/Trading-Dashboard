import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock supabase before importing api
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}))

// Import after mocks (using fetchBots which uses default retries=3)
const { fetchBots } = await import('../lib/api')

function makeOkResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeErrResponse(status: number, detail = 'error') {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('apiFetch retry logic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.useFakeTimers({ shouldAdvanceTime: false })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('retries on 5xx and succeeds on 3rd attempt (fetchBots, retries=3)', async () => {
    const mockFetch = vi.mocked(fetch)
    const paginatedOk = { bots: [], total: 0, limit: 50, offset: 0 }

    mockFetch
      .mockResolvedValueOnce(makeErrResponse(503))
      .mockResolvedValueOnce(makeErrResponse(503))
      .mockResolvedValueOnce(makeOkResponse(paginatedOk))

    const promise = fetchBots()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(result.total).toBe(0)
  })

  it('does NOT retry on 401 — calls unauthorizedHandler exactly once', async () => {
    const handler = vi.fn()
    const { registerUnauthorizedHandler } = await import('../lib/api')
    registerUnauthorizedHandler(handler)

    vi.mocked(fetch).mockResolvedValue(makeErrResponse(401, 'unauthorized'))

    try {
      await fetchBots()
    } catch {
      // expected — 401 always throws
    }

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('throws ApiError with status 503 after all retries exhausted', async () => {
    vi.mocked(fetch).mockResolvedValue(makeErrResponse(503, 'Service Unavailable'))

    let caughtError: unknown
    const promise = fetchBots().catch((e) => {
      caughtError = e
    })
    await vi.runAllTimersAsync()
    await promise

    expect(caughtError).toMatchObject({ status: 503 })
    // 1 initial + 3 retries = 4 total calls
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4)
  })

  it('applies exponential backoff: delays are 1000ms, 2000ms, 3000ms', async () => {
    vi.mocked(fetch).mockResolvedValue(makeErrResponse(503))

    const delays: number[] = []
    const realSetTimeout = globalThis.setTimeout
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms, ...args) => {
      if (typeof ms === 'number' && ms >= 1000) delays.push(ms)
      return realSetTimeout(fn, 0, ...args)
    })

    let caughtError: unknown
    const promise = fetchBots().catch((e) => {
      caughtError = e
    })
    await vi.runAllTimersAsync()
    await promise

    expect(caughtError).toBeDefined()
    expect(delays).toContain(1000)
    expect(delays).toContain(2000)
    expect(delays).toContain(3000)
  })
})
