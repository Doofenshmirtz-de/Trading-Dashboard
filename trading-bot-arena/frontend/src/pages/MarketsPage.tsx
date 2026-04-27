import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchPairs, fetchTicker } from '../lib/api'
import type { TradingPair } from '../types'

const PAGE_SIZE = 20

function PairRow({ pair }: { pair: TradingPair }) {
  const { data: ticker } = useQuery({
    queryKey: ['ticker', pair.symbol],
    queryFn: () => fetchTicker(pair.symbol),
    staleTime: 10_000,
    refetchInterval: 10_000,
    retry: 1,
  })

  const changeColor =
    ticker?.change == null
      ? 'text-slate-500'
      : ticker.change >= 0
        ? 'text-green-400'
        : 'text-red-400'

  return (
    <tr className="hover:bg-slate-700/30 transition-colors">
      <td className="px-5 py-3 font-mono text-sm text-white">{pair.symbol}</td>
      <td className="px-5 py-3 text-sm text-slate-400 hidden sm:table-cell">{pair.base}</td>
      <td className="px-5 py-3 text-sm text-white text-right">
        {ticker?.last != null ? `$${ticker.last.toLocaleString()}` : '—'}
      </td>
      <td className={`px-5 py-3 text-sm text-right ${changeColor}`}>
        {ticker?.change != null ? `${ticker.change >= 0 ? '+' : ''}${ticker.change.toFixed(2)}%` : '—'}
      </td>
      <td className="px-5 py-3 text-sm text-slate-400 text-right hidden md:table-cell">
        {ticker?.volume != null ? ticker.volume.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
      </td>
    </tr>
  )
}

export function MarketsPage() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')

  const { data: allPairs, isLoading } = useQuery({
    queryKey: ['pairs'],
    queryFn: fetchPairs,
    staleTime: 60_000,
  })

  const filtered = (allPairs ?? []).filter(
    (p) =>
      !search ||
      p.symbol.toLowerCase().includes(search.toLowerCase()) ||
      p.base.toLowerCase().includes(search.toLowerCase()),
  )

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const offset = page * PAGE_SIZE
  const paginated = filtered.slice(offset, offset + PAGE_SIZE)

  return (
    <div className="min-h-screen bg-slate-900 pt-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Markets</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              Binance Futures — USDT-M perpetuals
              {allPairs && ` (${allPairs.length} pairs)`}
            </p>
          </div>
          <input
            type="text"
            placeholder="Search…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 w-40"
          />
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">Loading pairs…</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Symbol
                    </th>
                    <th className="text-left px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider hidden sm:table-cell">
                      Base
                    </th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      Price
                    </th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider">
                      24h %
                    </th>
                    <th className="text-right px-5 py-3 text-xs text-slate-400 font-medium uppercase tracking-wider hidden md:table-cell">
                      Volume
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {paginated.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500 text-sm">
                        No pairs found
                      </td>
                    </tr>
                  ) : (
                    paginated.map((pair) => <PairRow key={pair.symbol} pair={pair} />)
                  )}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700">
                  <p className="text-slate-500 text-xs">
                    Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, filtered.length)} of{' '}
                    {filtered.length}
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

        {/* TODO Phase 3: Virtual scroll for large pair lists */}
      </div>
    </div>
  )
}
