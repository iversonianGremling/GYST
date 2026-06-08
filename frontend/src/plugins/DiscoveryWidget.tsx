import { useEffect, useState } from 'react'
import { RefreshCw, MapPin, Home, CalendarClock, ExternalLink, Music, Radio } from 'lucide-react'

const API = '/api/v1/plugins/discovery'

interface Place { id: string; label: string; scope: string; is_home: boolean; city: string | null }
interface Feed { id: string; label: string; categories: string[]; enabled: boolean }
interface Connector { id: string; provides: string[]; egress: string }
interface ResultItem {
  id: string; title: string; url: string | null; score: number
  category: string | null; location: string | null; starts_at: string | null; reasons: string[]
}
interface Profile { phrases: number; terms: string[] }

const j = (path: string) => fetch(`${API}${path}`, { credentials: 'include' }).then((r) => r.json())

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function DiscoveryWidget(_props: Record<string, unknown>) {
  const [places, setPlaces] = useState<Place[]>([])
  const [feeds, setFeeds] = useState<Feed[]>([])
  const [connectors, setConnectors] = useState<Connector[]>([])
  const [items, setItems] = useState<ResultItem[]>([])
  const [profile, setProfile] = useState<Profile>({ phrases: 0, terms: [] })
  const [ytLinked, setYtLinked] = useState(false)
  const [ytUrl, setYtUrl] = useState('')
  const [ytToken, setYtToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadAll = async () => {
    const [p, f, c, r, s] = await Promise.all([
      j('/places'), j('/feeds'), j('/connectors'), j('/results'), j('/settings'),
    ])
    setPlaces(p.places ?? [])
    setFeeds(f.feeds ?? [])
    setConnectors(c.connectors ?? [])
    setItems(r.items ?? [])
    setProfile(r.profile ?? { phrases: 0, terms: [] })
    setYtLinked(!!s.yamtrack_linked)
    setYtUrl(s.yamtrack_url ?? '')
  }
  useEffect(() => { loadAll() }, [])

  const refresh = async () => {
    setBusy(true); setMsg(null)
    const res = await fetch('/api/v1/feed/refresh', { method: 'POST', credentials: 'include' })
    const d = await res.json().catch(() => ({}))
    await loadAll()
    setMsg(`Refreshed — ${d.new_items ?? 0} new`)
    setBusy(false)
    setTimeout(() => setMsg(null), 4000)
  }

  const saveYt = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: Record<string, string> = {}
    if (ytUrl.trim()) body.yamtrack_url = ytUrl.trim()
    if (ytToken.trim()) body.yamtrack_token = ytToken.trim()
    const res = await fetch(`${API}/settings`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const d = await res.json()
    setYtLinked(!!d.yamtrack_linked); setYtToken('')
    setMsg('yamtrack link saved'); setTimeout(() => setMsg(null), 3000)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-text-2 flex items-center gap-1.5">
            <Radio size={14} className="text-accent" /> Discovery — local events matching your interests
          </h3>
          <p className="text-xs text-text-3 mt-0.5">
            Matching against {profile.phrases} name{profile.phrases === 1 ? '' : 's'}
            {profile.terms.length > 0 && <> + {profile.terms.join(', ')}</>}
            {ytLinked && <> · <Music size={10} className="inline" /> yamtrack linked</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {msg && <span className="text-xs text-accent">{msg}</span>}
          <button className="btn-ghost text-xs flex items-center gap-1.5" onClick={refresh} disabled={busy}>
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Refresh now
          </button>
        </div>
      </div>

      {/* Matches */}
      <div className="space-y-1.5">
        {items.length === 0 ? (
          <div className="card px-4 py-5 text-sm text-text-3">
            <p className="text-text-2 mb-1">No matching events right now.</p>
            <p>The whole Galician cultural agenda is scanned, but you only see events that intersect
              your tracked artists{profile.terms.length > 0 && <> and {profile.terms.join(' / ')}</>}.
              Nothing on offer matches at the moment — this fills in automatically as the agenda
              updates (checked every 30&nbsp;min).</p>
          </div>
        ) : (
          items.map((it) => (
            <div key={it.id} className="card px-3 py-2.5 hover:border-accent/40 transition-colors">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-1 font-medium truncate">{it.title}</span>
                    {it.url && (
                      <a href={it.url} target="_blank" rel="noreferrer" className="text-text-3 hover:text-accent shrink-0">
                        <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5 text-xs text-text-3">
                    {it.starts_at && <span className="flex items-center gap-1"><CalendarClock size={11} /> {fmtDate(it.starts_at)}</span>}
                    {it.location && <span className="flex items-center gap-1 truncate"><MapPin size={11} /> {it.location}</span>}
                    {it.category && <span className="bg-bg-3 px-1.5 py-0.5 rounded">{it.category}</span>}
                  </div>
                  {it.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {it.reasons.map((r, i) => (
                        <span key={i} className="text-[10px] text-accent bg-accent/10 px-1.5 py-0.5 rounded">{r}</span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-text-3 shrink-0 tabular-nums">{it.score.toFixed(2)}</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Places */}
      <div className="space-y-1">
        <p className="text-xs text-text-3 uppercase tracking-wide">Places</p>
        <div className="flex flex-wrap gap-1.5">
          {places.map((p) => (
            <span key={p.id} className="card px-2 py-1 text-xs text-text-2 flex items-center gap-1">
              {p.is_home ? <Home size={11} className="text-accent" /> : <MapPin size={11} className="text-text-3" />}
              {p.label}
              <span className="text-text-3">· {p.scope}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Feeds */}
      <div className="space-y-1">
        <p className="text-xs text-text-3 uppercase tracking-wide">Feeds</p>
        {feeds.length === 0 && <p className="text-sm text-text-3">No feeds yet.</p>}
        {feeds.map((f) => (
          <div key={f.id} className="card flex items-center gap-2 px-3 py-2">
            <span className={`h-1.5 w-1.5 rounded-full ${f.enabled ? 'bg-accent' : 'bg-text-3'}`} />
            <span className="text-sm text-text-2 flex-1 truncate">{f.label}</span>
            <span className="text-[10px] text-text-3">{f.categories.join(', ')}</span>
          </div>
        ))}
      </div>

      {/* Sources */}
      <div className="space-y-2">
        <p className="text-xs text-text-3 uppercase tracking-wide">Sources</p>
        <div className="flex flex-wrap gap-1.5">
          {connectors.map((c) => (
            <span key={c.id} className="card px-2 py-1 text-xs text-text-2">
              {c.id} <span className="text-text-3">· {c.provides.join('/')} · {c.egress}</span>
            </span>
          ))}
        </div>
        <form onSubmit={saveYt} className="flex flex-wrap gap-2 items-center">
          <Music size={13} className="text-text-3" />
          <input className="input text-sm flex-1 min-w-[160px]" placeholder="yamtrack URL (http://host:8000)"
            value={ytUrl} onChange={(e) => setYtUrl(e.target.value)} />
          <input className="input text-sm flex-1 min-w-[160px]" placeholder={ytLinked ? 'token (set ✓)' : 'yamtrack token'}
            value={ytToken} onChange={(e) => setYtToken(e.target.value)} type="password" />
          <button type="submit" className="btn-primary text-sm">Link</button>
        </form>
      </div>
    </div>
  )
}
