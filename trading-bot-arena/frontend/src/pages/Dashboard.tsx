import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { fetchBots } from '../lib/api'
import { SystemStatus } from '../components/ui/SystemStatus'
import { StatusBadge } from '../components/ui/StatusBadge'
import RegimeWidget from '../components/market/RegimeWidget'

export function Dashboard() {
  const { user } = useAuth()
  const { data: botsData } = useQuery({
    queryKey: ['bots', 1, 0],
    queryFn: () => fetchBots(5, 0),
  })

  const runningBots = botsData?.bots.filter((b) => b.status === 'running').length ?? 0
  const totalBots = botsData?.total ?? 0

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-white">
                Welcome back, <span className="text-blue-400">{user?.email?.split('@')[0]}</span>
              </h1>
              <p className="text-slate-400 mt-1 text-sm">Trading Bot Arena — Dashboard</p>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">
                  Total Bots
                </p>
                <p className="text-3xl font-bold text-white">{totalBots}</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">
                  Running
                </p>
                <p className="text-3xl font-bold text-green-400">{runningBots}</p>
              </div>
              <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
                <p className="text-slate-400 text-xs font-medium uppercase tracking-wider mb-1">
                  Stopped
                </p>
                <p className="text-3xl font-bold text-slate-400">{totalBots - runningBots}</p>
              </div>
            </div>

            {/* Recent bots */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
                <h2 className="text-white font-semibold">Recent Bots</h2>
                <Link
                  to="/bots"
                  className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                >
                  View all →
                </Link>
              </div>
              {botsData?.bots.length === 0 || !botsData ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-slate-500 text-sm mb-3">No bots yet</p>
                  <Link
                    to="/bots"
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    Create your first bot
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-slate-700">
                  {botsData.bots.map((bot) => (
                    <li key={bot.id} className="px-5 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm font-medium">{bot.name}</p>
                        <p className="text-slate-500 text-xs mt-0.5">
                          {bot.type} · {bot.trading_pair}
                        </p>
                      </div>
                      <StatusBadge status={bot.status} />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
              <Link
                to="/bots"
                className="bg-slate-800 border border-slate-700 hover:border-blue-500/50 rounded-xl p-5 transition-colors group"
              >
                <h3 className="text-white font-semibold group-hover:text-blue-400 transition-colors">
                  Manage Bots →
                </h3>
                <p className="text-slate-400 text-sm mt-1">
                  Create, start, stop and configure trading bots
                </p>
              </Link>
              <Link
                to="/markets"
                className="bg-slate-800 border border-slate-700 hover:border-blue-500/50 rounded-xl p-5 transition-colors group"
              >
                <h3 className="text-white font-semibold group-hover:text-blue-400 transition-colors">
                  Browse Markets →
                </h3>
                <p className="text-slate-400 text-sm mt-1">
                  Live Binance Futures pairs, candles and tickers
                </p>
              </Link>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block w-80 shrink-0 space-y-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">Market Regime</h3>
              <RegimeWidget symbol="BTC/USDT:USDT" timeframe="1h" />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">System</h3>
              <SystemStatus />
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
