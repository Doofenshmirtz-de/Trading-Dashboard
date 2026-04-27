export interface LogEntry {
  id: string
  timestamp: string
  method: string
  url: string
  status: number | null
  latency_ms: number
  error: string | null
  retries: number
}

const MAX_ENTRIES = 100
let _logs: LogEntry[] = []
const _listeners: Array<(logs: LogEntry[]) => void> = []

function fmt(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

export function addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
  const newEntry: LogEntry = {
    id: crypto.randomUUID(),
    timestamp: fmt(new Date()),
    ...entry,
  }
  _logs = [newEntry, ..._logs].slice(0, MAX_ENTRIES)
  _listeners.forEach((fn) => fn([..._logs]))
}

export function getLogs(): LogEntry[] {
  return [..._logs]
}

export function clearLogs(): void {
  _logs = []
  _listeners.forEach((fn) => fn([]))
}

export function subscribeToLogs(fn: (logs: LogEntry[]) => void): () => void {
  _listeners.push(fn)
  fn([..._logs])
  return () => {
    const idx = _listeners.indexOf(fn)
    if (idx !== -1) _listeners.splice(idx, 1)
  }
}
