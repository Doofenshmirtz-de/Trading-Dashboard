import type { BotStatus } from '../../types'

const STATUS_STYLES: Record<BotStatus, string> = {
  running: 'bg-green-500/20 text-green-400 border border-green-500/30',
  paused: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
  stopped: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
}

export function StatusBadge({ status }: { status: BotStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status]}`}
    >
      {status}
    </span>
  )
}
