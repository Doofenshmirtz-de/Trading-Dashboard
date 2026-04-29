import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { API_URL } from '../lib/api'
import { clearLogs, subscribeToLogs } from '../lib/requestLog'
import type { LogEntry } from '../lib/requestLog'

// ─── JSON Syntax Highlighter ──────────────────────────────────────────────────
function highlightJson(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(
      /("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g,
      (match) => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="text-slate-200">${match}</span>`
          return `<span class="text-green-300">${match}</span>`
        }
        if (/true|false/.test(match)) return `<span class="text-purple-300">${match}</span>`
        if (/null/.test(match)) return `<span class="text-slate-500">${match}</span>`
        return `<span class="text-blue-300">${match}</span>`
      },
    )
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Section({
  title,
  children,
  badge,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  badge?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-slate-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span
            className="text-slate-400 text-xs transition-transform duration-200 select-none"
            style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
          >
            ▶
          </span>
          <span className="text-slate-200 font-medium text-sm">{title}</span>
          {badge}
        </div>
      </button>
      <div
        style={{
          maxHeight: open ? '9999px' : '0',
          overflow: 'hidden',
          transition: 'max-height 0.25s ease',
        }}
      >
        <div className="px-5 pb-5 pt-1 border-t border-slate-700">{children}</div>
      </div>
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────
type PillStatus = 'idle' | 'running' | 'pass' | 'fail' | 'warn'
const PILL: Record<PillStatus, { label: string; cls: string }> = {
  idle: { label: '—', cls: 'text-slate-500' },
  running: { label: '⏳ Running', cls: 'text-yellow-400 animate-pulse' },
  pass: { label: '✅ Pass', cls: 'text-green-400' },
  fail: { label: '❌ Fail', cls: 'text-red-400' },
  warn: { label: '⚠️ Warn', cls: 'text-yellow-400' },
}

// ─── 1. Environment Section ───────────────────────────────────────────────────
function EnvSection() {
  const apiUrl = API_URL
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ''
  const mode = import.meta.env.MODE as string

  const rows = [
    { name: 'VITE_API_URL', value: apiUrl || '(leer)', status: apiUrl ? '✅ Set' : '❌ Missing', critical: !apiUrl },
    { name: 'VITE_SUPABASE_URL', value: supabaseUrl || '(leer)', status: supabaseUrl ? '✅ Set' : '❌ Missing', critical: !supabaseUrl },
    { name: 'VITE_SUPABASE_ANON_KEY', value: anonKey ? '***set***' : '(leer)', status: anonKey ? '✅ Set' : '❌ Missing', critical: !anonKey },
    { name: 'MODE', value: mode, status: 'ℹ️ Info', critical: false },
  ]

  return (
    <Section title="Environment">
      {!apiUrl && (
        <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-300 text-sm">
          ⚠️ VITE_API_URL ist nicht gesetzt — Backend-Verbindung schlägt fehl.
          <br />
          <span className="text-red-400/70 text-xs">
            Vercel → Settings → Environment Variables → VITE_API_URL → Redeploy
          </span>
        </div>
      )}
      <table className="w-full text-xs mt-2">
        <thead>
          <tr className="text-slate-500 border-b border-slate-700">
            <th className="text-left py-2 pr-4 font-medium">Variable</th>
            <th className="text-left py-2 pr-4 font-medium">Wert</th>
            <th className="text-left py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700/50">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="py-2 pr-4 font-mono text-slate-300">{r.name}</td>
              <td className="py-2 pr-4 font-mono text-slate-400 break-all max-w-xs">{r.value}</td>
              <td className={`py-2 ${r.critical ? 'text-red-400' : 'text-green-400'}`}>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

// ─── 2. Connection Test Section ───────────────────────────────────────────────
interface TestResult {
  status: PillStatus
  message: string
  detail?: string
}

function ConnectionSection() {
  const [tests, setTests] = useState<TestResult[]>([
    { status: 'idle', message: '' },
    { status: 'idle', message: '' },
    { status: 'idle', message: '' },
    { status: 'idle', message: '' },
  ])
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState('')

  function setTest(i: number, t: TestResult) {
    setTests((prev) => prev.map((x, j) => (j === i ? t : x)))
  }

  async function runTests() {
    setRunning(true)
    setSummary('')
    setTests([
      { status: 'idle', message: '' },
      { status: 'idle', message: '' },
      { status: 'idle', message: '' },
      { status: 'idle', message: '' },
    ])

    let passed = 0

    // Test 1: DNS / Reachability
    setTest(0, { status: 'running', message: 'Prüfe Erreichbarkeit…' })
    if (!API_URL) {
      setTest(0, { status: 'fail', message: 'VITE_API_URL ist nicht gesetzt', detail: 'Setze VITE_API_URL in Vercel und deploye neu.' })
    } else {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 5000)
        const res = await fetch(`${API_URL}/health`, { signal: ctrl.signal }).catch((e) => {
          throw e
        })
        clearTimeout(timer)
        setTest(0, { status: 'pass', message: `Backend erreichbar — HTTP ${res.status}` })
        passed++
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        const isCors = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed')
        setTest(0, {
          status: 'fail',
          message: isCors ? 'CORS-Fehler oder Netzwerkfehler' : `Nicht erreichbar: ${msg}`,
          detail: isCors
            ? `Mögliche Ursachen:\n1. CORS_ORIGINS in Railway enthält nicht: ${window.location.origin}\n2. Railway-Service läuft nicht\n3. VITE_API_URL falsch: ${API_URL}`
            : `URL: ${API_URL}`,
        })
      }
    }

    // Test 2: Health Endpoint
    setTest(1, { status: 'running', message: 'GET /health…' })
    let healthJson = ''
    try {
      const res = await fetch(`${API_URL}/health`)
      if (res.ok) {
        const body = await res.json()
        healthJson = JSON.stringify(body, null, 2)
        setTest(1, { status: 'pass', message: `200 OK — status: ${body.status}`, detail: healthJson })
        passed++
      } else {
        setTest(1, { status: 'fail', message: `HTTP ${res.status}`, detail: await res.text() })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setTest(1, { status: 'fail', message: msg })
    }

    // Test 3: CORS Check
    setTest(2, { status: 'running', message: 'CORS prüfen…' })
    try {
      const res = await fetch(`${API_URL}/health`, { method: 'OPTIONS' })
      const allow = res.headers.get('access-control-allow-origin')
      if (allow) {
        setTest(2, { status: 'pass', message: `CORS OK — Allow-Origin: ${allow}` })
        passed++
      } else {
        setTest(2, {
          status: 'warn',
          message: 'Kein access-control-allow-origin Header',
          detail: `Füge ${window.location.origin} zu CORS_ORIGINS in Railway hinzu.`,
        })
      }
    } catch {
      setTest(2, {
        status: 'fail',
        message: 'CORS blockiert Anfrage',
        detail: `Füge diese Origin zu CORS_ORIGINS in Railway hinzu:\n${window.location.origin}`,
      })
    }

    // Test 4: Auth Endpoint
    setTest(3, { status: 'running', message: 'GET /bots mit JWT…' })
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) {
      setTest(3, { status: 'warn', message: 'Kein JWT — nicht eingeloggt', detail: 'Einloggen um diesen Test zu nutzen.' })
    } else {
      try {
        const res = await fetch(`${API_URL}/bots`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) {
          setTest(3, { status: 'pass', message: `200 OK — JWT akzeptiert` })
          passed++
        } else if (res.status === 401) {
          setTest(3, { status: 'fail', message: '401 Unauthorized — JWT abgelehnt', detail: 'Prüfe SUPABASE_JWT_SECRET in Railway. Muss mit dem Wert in Supabase → Settings → API → JWT Secret übereinstimmen.' })
        } else {
          setTest(3, { status: 'warn', message: `HTTP ${res.status}` })
        }
      } catch (e) {
        setTest(3, { status: 'fail', message: e instanceof Error ? e.message : String(e) })
      }
    }

    setSummary(`${passed}/4 Tests bestanden`)
    setRunning(false)
  }

  const testLabels = [
    'DNS / Erreichbarkeit',
    'Health Endpoint (GET /health)',
    'CORS-Header',
    'Auth Endpoint (GET /bots + JWT)',
  ]

  return (
    <Section title="Connection Test">
      <div className="space-y-3 mt-2">
        {tests.map((t, i) => (
          <div key={i} className="bg-slate-900 rounded-lg p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-slate-300 text-xs font-medium">{testLabels[i]}</p>
                {t.message && <p className={`text-xs mt-1 ${PILL[t.status].cls}`}>{t.message}</p>}
                {t.detail && (
                  <pre className="text-slate-400 text-[10px] mt-2 whitespace-pre-wrap leading-relaxed font-mono bg-slate-950 rounded p-2">
                    {t.detail}
                  </pre>
                )}
              </div>
              <span className={`text-xs shrink-0 ${PILL[t.status].cls}`}>{PILL[t.status].label}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4">
        <button
          onClick={runTests}
          disabled={running}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {running ? 'Läuft…' : 'Tests starten'}
        </button>
        {summary && (
          <span className={`text-sm font-medium ${summary.startsWith('4/4') ? 'text-green-400' : 'text-yellow-400'}`}>
            {summary.startsWith('4/4') ? `✅ ${summary}` : `⚠️ ${summary}`}
          </span>
        )}
      </div>
    </Section>
  )
}

// ─── 3. Auth & JWT Inspector ──────────────────────────────────────────────────
function AuthSection() {
  const [session, setSession] = useState<{ email?: string; userId?: string; token?: string; exp?: number } | null>(null)
  const [refreshMsg, setRefreshMsg] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { setSession(null); return }
      const token = data.session.access_token
      let exp: number | undefined
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        exp = payload.exp as number
      } catch { /* ignore */ }
      setSession({ email: data.session.user.email, userId: data.session.user.id, token, exp })
    })
  }, [])

  async function refreshSession() {
    setRefreshMsg('')
    const { error } = await supabase.auth.refreshSession()
    setRefreshMsg(error ? `❌ ${error.message}` : '✅ Session erneuert')
  }

  async function copyUserId() {
    if (!session?.userId) return
    await navigator.clipboard.writeText(session.userId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const now = Date.now() / 1000
  const expiresIn = session?.exp ? session.exp - now : null
  const tokenStatus = expiresIn === null ? '—' : expiresIn > 0 ? `in ${Math.round(expiresIn / 60)} min` : 'ABGELAUFEN'

  const rows = session
    ? [
        { label: 'Auth Status', value: '● Authentifiziert', cls: 'text-green-400' },
        { label: 'E-Mail', value: session.email ?? '—', cls: 'text-slate-300' },
        { label: 'User ID', value: session.userId ?? '—', cls: 'text-slate-300 font-mono text-[11px]' },
        { label: 'Token Status', value: expiresIn !== null && expiresIn > 0 ? 'Gültig' : 'Abgelaufen', cls: expiresIn !== null && expiresIn > 0 ? 'text-green-400' : 'text-red-400' },
        { label: 'Token läuft ab', value: tokenStatus, cls: expiresIn !== null && expiresIn > 60 ? 'text-slate-300' : 'text-yellow-400' },
        { label: 'Token Preview', value: session.token ? `${session.token.slice(0, 20)}…${session.token.slice(-10)}` : '—', cls: 'text-slate-400 font-mono text-[11px]' },
      ]
    : [{ label: 'Auth Status', value: '○ Nicht eingeloggt', cls: 'text-slate-500' }]

  return (
    <Section title="Auth & JWT Inspector">
      <table className="w-full text-xs mt-2">
        <tbody className="divide-y divide-slate-700/50">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 pr-4 text-slate-500 w-36 shrink-0">{r.label}</td>
              <td className={`py-2 break-all ${r.cls}`}>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {session && (
        <div className="flex gap-2 mt-4 flex-wrap">
          <button
            onClick={refreshSession}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors"
          >
            Session erneuern
          </button>
          <button
            onClick={copyUserId}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors"
          >
            {copied ? '✅ Kopiert!' : 'User ID kopieren'}
          </button>
          {refreshMsg && <span className="text-xs self-center text-slate-400">{refreshMsg}</span>}
        </div>
      )}
    </Section>
  )
}

// ─── 4. API Request Log ───────────────────────────────────────────────────────
function statusColor(status: number | null): string {
  if (status === null) return 'text-red-400 italic'
  if (status < 300) return 'text-green-400'
  if (status < 500) return 'text-yellow-400'
  return 'text-red-400'
}

function RequestLogSection({ onClear }: { onClear: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => subscribeToLogs(setLogs), [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  return (
    <Section
      title="API Request Log"
      badge={
        <span className="ml-2 bg-slate-700 text-slate-400 text-[10px] px-2 py-0.5 rounded-full">
          {logs.length}
        </span>
      }
    >
      {logs.length === 0 ? (
        <p className="text-slate-600 text-xs py-3">Noch keine Requests. Navigiere durch die App.</p>
      ) : (
        <div className="bg-slate-950 rounded-lg overflow-auto max-h-64 mt-2">
          <table className="w-full text-[11px] font-mono">
            <thead className="sticky top-0 bg-slate-900">
              <tr className="text-slate-500">
                <th className="text-left px-3 py-2">Zeit</th>
                <th className="text-left px-3 py-2">Method</th>
                <th className="text-left px-3 py-2">URL</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">ms</th>
                <th className="text-left px-3 py-2">Retry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {[...logs].reverse().map((l) => (
                <tr key={l.id} className="hover:bg-slate-900/50">
                  <td className="px-3 py-1.5 text-slate-500">{l.timestamp}</td>
                  <td className="px-3 py-1.5 text-slate-300">{l.method}</td>
                  <td className="px-3 py-1.5 text-slate-400 max-w-[200px] truncate" title={l.url}>
                    {l.url.replace(API_URL, '')}
                  </td>
                  <td className={`px-3 py-1.5 ${statusColor(l.status)}`}>
                    {l.status ?? 'ERR'}
                    {l.error && !l.status ? ` (${l.error.slice(0, 20)})` : ''}
                  </td>
                  <td className="px-3 py-1.5 text-slate-400">{l.latency_ms}</td>
                  <td className="px-3 py-1.5 text-slate-500">{l.retries > 0 ? `×${l.retries}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div ref={bottomRef} />
        </div>
      )}
      <button
        onClick={() => { clearLogs(); onClear() }}
        className="mt-3 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        Log leeren
      </button>
    </Section>
  )
}

// ─── 5. Manual Endpoint Tester ────────────────────────────────────────────────
function EndpointTester() {
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/health')
  const [withAuth, setWithAuth] = useState(true)
  const [body, setBody] = useState('')
  const [timeout, setTimeout_] = useState(10)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ status: number | null; latency: number; body: string; error?: string } | null>(null)
  const [copied, setCopied] = useState(false)

  function formatBody() {
    try { setBody(JSON.stringify(JSON.parse(body), null, 2)) } catch { /* ignore */ }
  }

  async function sendRequest() {
    setLoading(true)
    setResult(null)
    const t0 = performance.now()
    try {
      const ctrl = new AbortController()
      const timer = globalThis.setTimeout(() => ctrl.abort(), timeout * 1000)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (withAuth) {
        const { data } = await supabase.auth.getSession()
        const token = data.session?.access_token
        if (token) headers['Authorization'] = `Bearer ${token}`
      }
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers,
        body: ['POST', 'PATCH'].includes(method) && body ? body : undefined,
        signal: ctrl.signal,
      })
      clearTimeout(timer)
      const latency = Math.round(performance.now() - t0)
      let text = ''
      try {
        const json = await res.json()
        text = JSON.stringify(json, null, 2)
      } catch {
        text = await res.text()
      }
      setResult({ status: res.status, latency, body: text })
    } catch (e) {
      const latency = Math.round(performance.now() - t0)
      setResult({ status: null, latency, body: '', error: e instanceof Error ? e.message : String(e) })
    }
    setLoading(false)
  }

  return (
    <Section title="Manual Endpoint Tester">
      <div className="space-y-3 mt-2">
        <div className="flex gap-2 flex-wrap">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white"
          >
            {['GET', 'POST', 'PATCH', 'DELETE'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <div className="flex-1 flex items-center bg-slate-700 border border-slate-600 rounded overflow-hidden">
            <span className="px-2 text-slate-500 text-xs shrink-0 font-mono truncate max-w-[140px]" title={API_URL}>
              {API_URL || 'http://…'}
            </span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/health"
              className="flex-1 bg-transparent px-2 py-1.5 text-sm text-white focus:outline-none"
            />
          </div>
          <input
            type="number"
            value={timeout}
            onChange={(e) => setTimeout_(Number(e.target.value))}
            min={1}
            max={60}
            className="w-16 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-white text-center"
            title="Timeout (Sekunden)"
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={withAuth}
              onChange={(e) => setWithAuth(e.target.checked)}
              className="accent-blue-500"
            />
            JWT
          </label>
        </div>

        {['POST', 'PATCH'].includes(method) && (
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-slate-500">Request Body (JSON)</span>
              <button onClick={formatBody} className="text-[10px] text-slate-500 hover:text-slate-300">Format JSON</button>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder='{"key": "value"}'
              className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none focus:border-blue-500 resize-y"
            />
          </div>
        )}

        <button
          onClick={sendRequest}
          disabled={loading || !API_URL}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Sende…' : 'Send Request'}
        </button>

        {result && (
          <div className="bg-slate-950 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800">
              <div className="flex items-center gap-3 text-xs">
                <span className={statusColor(result.status)}>
                  {result.status ?? 'Network Error'}
                </span>
                <span className="text-slate-500">{result.latency}ms</span>
              </div>
              {result.body && (
                <button
                  onClick={() => { void navigator.clipboard.writeText(result.body); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="text-[10px] text-slate-500 hover:text-slate-300"
                >
                  {copied ? '✅ Kopiert' : 'Kopieren'}
                </button>
              )}
            </div>
            {result.error ? (
              <p className="px-4 py-3 text-red-400 text-xs font-mono">{result.error}</p>
            ) : (
              <pre
                className="px-4 py-3 text-xs font-mono overflow-auto max-h-64 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: highlightJson(result.body) }}
              />
            )}
          </div>
        )}
      </div>
    </Section>
  )
}

// ─── 6. Bots Diagnose ────────────────────────────────────────────────────────

const BOT_TEMPLATES: Record<string, Record<string, unknown>> = {
  rule_based: { indicator: 'RSI', timeframe: '1h' },
  copy_trading: { trader_id: 'trader_abc123' },
  ml: { model_name: 'my_model_v1' },
  custom: {},
}

function BotsDiagnoseSection() {
  const [botType, setBotType] = useState('rule_based')
  const [name, setName] = useState('Test Bot Debug')
  const [tradingPair, setTradingPair] = useState('BTC/USDT:USDT')
  const [virtualBalance, setVirtualBalance] = useState(10000)
  const [configJson, setConfigJson] = useState(
    JSON.stringify(BOT_TEMPLATES['rule_based'], null, 2),
  )
  const [configError, setConfigError] = useState('')
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(false)
  const [createResult, setCreateResult] = useState<{ status: number | null; latency: number; body: string; error?: string } | null>(null)
  const [listResult, setListResult] = useState<{ status: number | null; latency: number; body: string } | null>(null)
  const [deleteResult, setDeleteResult] = useState<{ id: string; status: number | null; body: string } | null>(null)

  function onTypeChange(t: string) {
    setBotType(t)
    setConfigJson(JSON.stringify(BOT_TEMPLATES[t] ?? {}, null, 2))
    setConfigError('')
  }

  function validateConfig(): Record<string, unknown> | null {
    try {
      const parsed = JSON.parse(configJson)
      setConfigError('')
      return parsed
    } catch {
      setConfigError('Ungültiges JSON')
      return null
    }
  }

  function buildPayload(): Record<string, unknown> | null {
    const config = validateConfig()
    if (!config) return null
    return {
      name,
      type: botType,
      config,
      virtual_balance: virtualBalance,
      initial_balance: virtualBalance,
      trading_pair: tradingPair,
    }
  }

  async function sendCreate() {
    const payload = buildPayload()
    if (!payload) return
    setLoading(true)
    setCreateResult(null)
    const t0 = performance.now()
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(`${API_URL}/bots`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const latency = Math.round(performance.now() - t0)
      let text = ''
      try { text = JSON.stringify(await res.json(), null, 2) } catch { text = await res.text() }
      setCreateResult({ status: res.status, latency, body: text })
    } catch (e) {
      const latency = Math.round(performance.now() - t0)
      setCreateResult({ status: null, latency, body: '', error: e instanceof Error ? e.message : String(e) })
    }
    setLoading(false)
  }

  async function sendList() {
    setListLoading(true)
    setListResult(null)
    const t0 = performance.now()
    try {
      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      const res = await fetch(`${API_URL}/bots?limit=20&offset=0`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      })
      const latency = Math.round(performance.now() - t0)
      let text = ''
      try { text = JSON.stringify(await res.json(), null, 2) } catch { text = await res.text() }
      setListResult({ status: res.status, latency, body: text })
    } catch (e) {
      const latency = Math.round(performance.now() - t0)
      setListResult({ status: null, latency, body: String(e) })
    }
    setListLoading(false)
  }

  async function deleteBot(id: string) {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const res = await fetch(`${API_URL}/bots/${id}`, {
      method: 'DELETE',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
    let text = ''
    try { text = JSON.stringify(await res.json(), null, 2) } catch { text = await res.text() }
    setDeleteResult({ id, status: res.status, body: text })
    void sendList()
  }

  // Parse bot list from listResult for the table view
  let botList: Array<Record<string, unknown>> = []
  if (listResult?.body) {
    try {
      const parsed = JSON.parse(listResult.body) as { bots?: Array<Record<string, unknown>> }
      botList = parsed.bots ?? []
    } catch { /* ignore */ }
  }

  const payload = buildPayload()

  return (
    <Section title="Bots Diagnose">
      {/* ── Create Form ── */}
      <div className="mt-2 space-y-4">
        <p className="text-xs text-slate-400">
          Erstelle einen Testbot direkt aus dem Debug Panel — zeigt Request, Response und Fehlerdetails.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {/* Name */}
          <div className="col-span-2 sm:col-span-1">
            <label className="block text-[11px] text-slate-500 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Typ</label>
            <select
              value={botType}
              onChange={(e) => onTypeChange(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white"
            >
              {['rule_based', 'copy_trading', 'ml', 'custom'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Trading Pair */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Trading Pair</label>
            <input
              value={tradingPair}
              onChange={(e) => setTradingPair(e.target.value)}
              placeholder="BTC/USDT:USDT"
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Virtual Balance */}
          <div>
            <label className="block text-[11px] text-slate-500 mb-1">Virtual Balance</label>
            <input
              type="number"
              value={virtualBalance}
              onChange={(e) => setVirtualBalance(Number(e.target.value))}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Config JSON */}
          <div className="col-span-2">
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] text-slate-500">Config (JSON) — Pflichtfelder für <span className="text-yellow-400">{botType}</span>: {JSON.stringify(Object.keys(BOT_TEMPLATES[botType] ?? {}))}</label>
            </div>
            <textarea
              value={configJson}
              onChange={(e) => { setConfigJson(e.target.value); setConfigError('') }}
              rows={3}
              className={`w-full bg-slate-950 border rounded px-3 py-2 text-xs font-mono text-slate-300 focus:outline-none resize-y ${configError ? 'border-red-500' : 'border-slate-700 focus:border-blue-500'}`}
            />
            {configError && <p className="text-red-400 text-[11px] mt-1">{configError}</p>}
          </div>
        </div>

        {/* Payload Preview */}
        {payload && (
          <div>
            <p className="text-[11px] text-slate-500 mb-1">Payload Preview (wird genau so gesendet):</p>
            <pre
              className="bg-slate-950 rounded px-3 py-2 text-[11px] font-mono overflow-auto max-h-32 leading-relaxed"
              dangerouslySetInnerHTML={{ __html: highlightJson(JSON.stringify(payload, null, 2)) }}
            />
          </div>
        )}

        <button
          onClick={sendCreate}
          disabled={loading || !API_URL}
          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Sende POST /bots…' : 'Bot erstellen (POST /bots)'}
        </button>

        {/* Create Result */}
        {createResult && (
          <div className="bg-slate-950 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-800 text-xs">
              <span className={statusColor(createResult.status)}>
                {createResult.status ?? 'Network Error'}
              </span>
              <span className="text-slate-500">{createResult.latency}ms</span>
              {createResult.status === 500 && (
                <span className="text-red-400 font-medium">⚠️ Backend-Fehler — sieh Railway Logs</span>
              )}
              {createResult.status === 422 && (
                <span className="text-yellow-400 font-medium">Validierungsfehler (422)</span>
              )}
              {createResult.status === 201 && (
                <span className="text-green-400 font-medium">✅ Bot erstellt!</span>
              )}
            </div>
            {createResult.error ? (
              <p className="px-4 py-3 text-red-400 text-xs font-mono">{createResult.error}</p>
            ) : (
              <pre
                className="px-4 py-3 text-xs font-mono overflow-auto max-h-48 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: highlightJson(createResult.body) }}
              />
            )}
          </div>
        )}

        {/* ── Bot List ── */}
        <div className="border-t border-slate-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Bot-Liste (GET /bots)</p>
            <button
              onClick={sendList}
              disabled={listLoading}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {listLoading ? 'Lädt…' : 'Liste aktualisieren'}
            </button>
          </div>

          {listResult && (
            <>
              <div className="flex items-center gap-2 mb-2 text-xs">
                <span className={statusColor(listResult.status)}>{listResult.status}</span>
                <span className="text-slate-500">{listResult.latency}ms</span>
                {botList.length > 0 && (
                  <span className="text-slate-500">{botList.length} Bot(s) gefunden</span>
                )}
              </div>

              {botList.length > 0 ? (
                <div className="space-y-2">
                  {botList.map((bot) => {
                    const id = String(bot.id ?? '')
                    return (
                      <div key={id} className="bg-slate-900 rounded-lg p-3 text-xs font-mono">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white font-semibold text-sm">{String(bot.name)}</span>
                              <span className="text-slate-500 text-[10px] px-1.5 py-0.5 bg-slate-800 rounded">{String(bot.type)}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${bot.status === 'running' ? 'bg-green-900 text-green-400' : bot.status === 'paused' ? 'bg-yellow-900 text-yellow-400' : 'bg-slate-800 text-slate-400'}`}>
                                {String(bot.status)}
                              </span>
                            </div>
                            <div className="text-slate-500 break-all">
                              <span className="text-slate-600">id: </span>
                              <span className="text-slate-400 select-all">{id}</span>
                            </div>
                            <div className="text-slate-500">
                              <span className="text-slate-600">pair: </span>{String(bot.trading_pair)}
                              <span className="ml-3 text-slate-600">balance: </span>{String(bot.virtual_balance)}
                              <span className="ml-3 text-slate-600">config: </span>
                              <span className="text-slate-400">{JSON.stringify(bot.config)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => { void deleteBot(id) }}
                            className="shrink-0 text-[11px] bg-red-900/40 hover:bg-red-900/70 text-red-400 px-2 py-1 rounded transition-colors"
                            title="Bot löschen"
                          >
                            Löschen
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : listResult.status === 200 ? (
                <p className="text-slate-600 text-xs py-2">Keine Bots vorhanden.</p>
              ) : (
                <pre
                  className="bg-slate-950 rounded px-3 py-2 text-[11px] font-mono overflow-auto max-h-32"
                  dangerouslySetInnerHTML={{ __html: highlightJson(listResult.body) }}
                />
              )}
            </>
          )}

          {deleteResult && (
            <div className={`mt-2 text-xs px-3 py-2 rounded ${deleteResult.status === 200 ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
              DELETE {deleteResult.id.slice(0, 8)}… → {deleteResult.status} {deleteResult.body}
            </div>
          )}
        </div>
      </div>
    </Section>
  )
}

// ─── Main Debug Page ──────────────────────────────────────────────────────────
export function DebugPage() {
  const [, forceUpdate] = useState(0)

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">🛠 Debug Panel</h1>
            <p className="text-slate-400 text-sm mt-1">
              Diagnose-Tool für Backend-Verbindung und Auth
            </p>
          </div>
          <button
            onClick={() => { clearLogs(); forceUpdate((n) => n + 1) }}
            className="text-xs text-slate-500 hover:text-slate-300 border border-slate-700 hover:border-slate-500 px-3 py-1.5 rounded transition-colors"
          >
            Logs leeren
          </button>
        </div>

        <div className="space-y-4">
          <EnvSection />
          <ConnectionSection />
          <AuthSection />
          <BotsDiagnoseSection />
          <RequestLogSection onClear={() => forceUpdate((n) => n + 1)} />
          <EndpointTester />
        </div>
      </div>
    </div>
  )
}
