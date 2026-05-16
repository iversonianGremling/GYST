import { useEffect, useState } from 'react'
import { Plus, Trash2, RefreshCw, Globe } from 'lucide-react'

interface FeedEntry { url: string; interest_id: string | null }

export default function RssFeedWidget(_props: Record<string, unknown>) {
  const [feeds,    setFeeds]    = useState<FeedEntry[]>([])
  const [newUrl,   setNewUrl]   = useState('')
  const [fetching, setFetching] = useState(false)
  const [msg,      setMsg]      = useState<string | null>(null)

  const load = () =>
    fetch('/api/v1/plugins/rss-feed/feeds', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setFeeds(d.feeds ?? []))

  useEffect(() => { load() }, [])

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newUrl.trim()) return
    const res = await fetch('/api/v1/plugins/rss-feed/feeds', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newUrl.trim(), interest_id: null }),
    })
    const d = await res.json()
    setFeeds(d.feeds ?? [])
    setNewUrl('')
  }

  const remove = async (entry: FeedEntry) => {
    const res = await fetch('/api/v1/plugins/rss-feed/feeds', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: entry.url, interest_id: entry.interest_id }),
    })
    const d = await res.json()
    setFeeds(d.feeds ?? [])
  }

  const fetchNow = async () => {
    setFetching(true)
    setMsg(null)
    const res = await fetch('/api/v1/feed/refresh', { method: 'POST', credentials: 'include' })
    const d = await res.json()
    setMsg(`+${d.new_items} new items`)
    setFetching(false)
    setTimeout(() => setMsg(null), 4000)
  }

  // Show all feeds in settings, grouped by whether they're interest-linked
  const globalFeeds   = feeds.filter((f) => !f.interest_id)
  const linkedFeeds   = feeds.filter((f) =>  f.interest_id)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-2">RSS / Atom Feeds</h3>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-accent">{msg}</span>}
          <button
            className="btn-ghost text-xs flex items-center gap-1.5"
            onClick={fetchNow}
            disabled={fetching}
          >
            <RefreshCw size={12} className={fetching ? 'animate-spin' : ''} />
            Fetch now
          </button>
        </div>
      </div>

      {/* Add global feed */}
      <form onSubmit={add} className="flex gap-2">
        <input
          className="input flex-1 text-sm"
          placeholder="https://example.com/feed.xml"
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          type="url"
        />
        <button type="submit" className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> Add global
        </button>
      </form>

      {/* Global feeds */}
      {globalFeeds.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-text-3 uppercase tracking-wide">Global</p>
          {globalFeeds.map((f) => (
            <div key={f.url} className="card flex items-center gap-2 px-3 py-2 hover:border-accent/40 transition-colors">
              <Globe size={13} className="text-text-3 shrink-0" />
              <span className="flex-1 text-sm text-text-2 truncate">{f.url}</span>
              <button onClick={() => remove(f)} className="text-text-3 hover:text-danger p-1" aria-label="Remove">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Interest-linked feeds (read-only here — managed from interest pages) */}
      {linkedFeeds.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-text-3 uppercase tracking-wide">Per-interest ({linkedFeeds.length})</p>
          {linkedFeeds.map((f) => (
            <div key={`${f.url}:${f.interest_id}`} className="card flex items-center gap-2 px-3 py-2 hover:border-accent/40 transition-colors opacity-75">
              <span className="flex-1 text-sm text-text-2 truncate">{f.url}</span>
              <span className="text-[10px] text-text-3 bg-bg-3 px-1.5 py-0.5 rounded shrink-0">interest</span>
              <button onClick={() => remove(f)} className="text-text-3 hover:text-danger p-1" aria-label="Remove">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      {feeds.length === 0 && (
        <p className="text-sm text-text-3">No feeds added yet. Add a global feed above, or subscribe from an interest page.</p>
      )}
    </div>
  )
}
