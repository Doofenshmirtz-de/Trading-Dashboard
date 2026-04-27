import { useQuery } from '@tanstack/react-query'
import { fetchHealth, API_URL } from '../../lib/api'
import type { HealthResponse } from '../../types'

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
  )
}

function ServiceRow({ name, service }: { name: string; service: HealthResponse['services']['binance'] }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <div className="flex items-center gap-1.5">
        <StatusDot connected={service.connected} />
        <span className="text-slate-300">{name}</span>
      </div>
      <span className="text-slate-500">
        {service.latency_ms !== null ? `${service.latency_ms}ms` : '—'}
      </span>
    </div>
  )
}

export function SystemStatus() {
  const { data, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: 1,
  })

  const overallColor =
    !data || isError
      ? 'bg-slate-600'
      : data.status === 'ok'
        ? 'bg-green-500'
        : data.status === 'degraded'
          ? 'bg-yellow-500'
          : 'bg-red-500'

  const lastChecked = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null

  const errMsg = isError && error instanceof Error ? error.message : null

  return (
    <div className="border-t border-slate-700 pt-4 mt-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${overallColor}`} />
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          System Status
        </span>
      </div>

      {/* API URL diagnostic */}
      <div className="mb-2">
        <p className="text-slate-600 text-[10px] font-mono truncate" title={API_URL || '(nicht gesetzt)'}>
          {API_URL ? API_URL.slice(0, 38) + (API_URL.length > 38 ? '…' : '') : '⚠ VITE_API_URL fehlt'}
        </p>
        {lastChecked && (
          <p className="text-slate-600 text-[10px]">Zuletzt: {lastChecked}</p>
        )}
      </div>

      {data ? (
        <div className="space-y-1.5">
          <ServiceRow name="Binance" service={data.services.binance} />
          <ServiceRow name="Supabase" service={data.services.supabase} />
        </div>
      ) : isError ? (
        <div>
          <p className="text-red-400 text-[10px] leading-tight break-words">
            {errMsg?.includes('VITE_API_URL')
              ? '⚠ VITE_API_URL nicht gesetzt'
              : errMsg?.includes('Failed to fetch') || errMsg?.includes('NetworkError')
                ? 'CORS oder Netzwerkfehler'
                : (errMsg ?? 'Nicht erreichbar')}
          </p>
          {!API_URL && (
            <p className="text-yellow-500 text-[10px] mt-1">
              → Vercel: VITE_API_URL setzen
            </p>
          )}
        </div>
      ) : (
        <p className="text-slate-500 text-xs">Laden…</p>
      )}
    </div>
  )
}
