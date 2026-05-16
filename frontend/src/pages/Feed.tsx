import { useEffect, useState } from 'react'
import { RefreshCw, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { api, type FeedItem } from '@/api/client'
import { formatRelative } from '@/lib/utils'

export default function Feed() {
  const [items, setItems] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastNewCount, setLastNewCount] = useState<number | null>(null)
  const [showBreakdown, setShowBreakdown] = useState<string | null>(null)

  const loadItems = () => {
    setLoading(true)
    api.get<FeedItem[]>('/feed').then(setItems).finally(() => setLoading(false))
  }

  const refresh = async () => {
    setRefreshing(true)
    setLastNewCount(null)
    try {
      const result = await api.post<{ new_items: number }>('/feed/refresh')
      setLastNewCount(result.new_items)
      loadItems()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(loadItems, [])

  const markSeen = async (id: string) => {
    await api.post(`/feed/${id}/seen`)
    setItems((prev) => prev.filter((f) => f.id !== id))
  }

  if (loading) return <div className="p-6 text-text-3">Loading feed…</div>

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Feed</h1>
          {items.length > 0 && (
            <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
              {items.length} unread
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {lastNewCount !== null && (
            <span className="text-xs text-text-3">
              {lastNewCount === 0 ? 'No new items' : `+${lastNewCount} new`}
            </span>
          )}
          <button
            className="btn-ghost text-sm flex items-center gap-1.5"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            {refreshing ? 'Fetching…' : 'Refresh'}
          </button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="card p-8 text-center text-text-3">
          <p className="text-2xl mb-2">✓</p>
          <p>You're all caught up.</p>
          <p className="text-xs mt-1">Enable feed plugins in Settings to populate your feed.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="card p-4 hover:border-bg-4 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {item.url ? (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-text-1 hover:text-accent line-clamp-2"
                    >
                      {item.title}
                    </a>
                  ) : (
                    <span className="text-sm font-medium text-text-1">{item.title}</span>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs bg-bg-3 text-text-3 px-1.5 py-0.5 rounded">
                      {item.source_plugin}
                    </span>
                    <span className="text-xs text-text-3">{formatRelative(item.fetched_at)}</span>
                    <span className="text-text-3">·</span>
                    <span className="text-xs text-text-3">score {item.score.toFixed(2)}</span>
                    <button
                      className="text-xs text-text-3 hover:text-accent flex items-center gap-0.5 transition-colors"
                      onClick={() => setShowBreakdown(showBreakdown === item.id ? null : item.id)}
                    >
                      why? {showBreakdown === item.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>
                  </div>
                  {showBreakdown === item.id && (
                    <pre className="text-[10px] text-text-3 bg-bg-3 rounded p-2 mt-2 overflow-x-auto">
                      {JSON.stringify(item.score_breakdown, null, 2)}
                    </pre>
                  )}
                </div>
                <button
                  className="btn-ghost text-xs shrink-0 flex items-center gap-1"
                  onClick={() => markSeen(item.id)}
                >
                  <Check size={13} /> Done
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
