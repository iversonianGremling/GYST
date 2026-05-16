import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, CalendarDays, FileText, Rss } from 'lucide-react'
import { api, type Interest, type CalendarEvent, type Note } from '@/api/client'
import { formatRelative, formatDate } from '@/lib/utils'

export default function Home() {
  const [interests, setInterests]   = useState<Interest[]>([])
  const [events,    setEvents]      = useState<CalendarEvent[]>([])
  const [notes,     setNotes]       = useState<Note[]>([])
  const [unread,    setUnread]      = useState<number | null>(null)

  useEffect(() => {
    const now = new Date()
    const weekLater = new Date(now.getTime() + 7 * 86400_000)

    Promise.all([
      api.get<Interest[]>('/interests'),
      api.get<CalendarEvent[]>(`/events?from_=${now.toISOString()}&to=${weekLater.toISOString()}`),
      api.get<Note[]>('/notes'),
      api.get<{ unread: number; total: number }>('/feed/stats'),
    ]).then(([ints, evts, nts, stats]) => {
      setInterests(ints.slice(0, 6))
      setEvents(evts.slice(0, 5))
      setNotes(nts.slice(0, 5))
      setUnread(stats.unread)
    })
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      {/* Quick-create bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Link to="/notes/new"    className="btn-ghost text-sm flex items-center gap-1.5"><Plus size={14} /><FileText size={14} /> Note</Link>
        <Link to="/calendar"     className="btn-ghost text-sm flex items-center gap-1.5"><Plus size={14} /><CalendarDays size={14} /> Event</Link>
        <Link to="/interests"    className="btn-ghost text-sm flex items-center gap-1.5"><Plus size={14} /> Interest</Link>
        {unread !== null && unread > 0 && (
          <Link to="/feed" className="ml-auto flex items-center gap-1.5 text-sm text-accent hover:underline">
            <Rss size={14} />
            {unread} unread
          </Link>
        )}
      </div>

      {/* Upcoming events */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide">Upcoming — 7 days</h2>
          <Link to="/calendar" className="text-xs text-text-3 hover:text-accent">Calendar →</Link>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-text-3">Nothing scheduled.</p>
        ) : (
          <div className="space-y-1.5">
            {events.map((e) => (
              <div key={e.id} className="card flex items-center gap-3 px-3 py-2.5 hover:border-accent/40 transition-colors">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: e.color || 'var(--color-accent)' }} />
                <span className="text-sm text-text-1 flex-1 truncate">{e.title}</span>
                <span className="text-xs text-text-3 shrink-0">{formatDate(e.starts_at)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent notes */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide">Recent notes</h2>
          <Link to="/notes" className="text-xs text-text-3 hover:text-accent">All notes →</Link>
        </div>
        {notes.length === 0 ? (
          <p className="text-sm text-text-3">No notes yet. <Link to="/notes/new">Write one</Link>.</p>
        ) : (
          <div className="space-y-1.5">
            {notes.map((n) => (
              <Link
                key={n.id}
                to={`/notes/${n.id}`}
                className="card flex items-center justify-between px-3 py-2.5 hover:border-accent/40 transition-colors"
              >
                <span className="text-sm text-text-1 truncate">{n.title}</span>
                <span className="text-xs text-text-3 shrink-0 ml-3">{formatRelative(n.updated_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Recent interests */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide">Interests</h2>
          <Link to="/interests" className="text-xs text-text-3 hover:text-accent">View all →</Link>
        </div>
        {interests.length === 0 ? (
          <p className="text-sm text-text-3">No interests yet. <Link to="/interests">Create one</Link>.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {interests.map((i) => (
              <Link
                key={i.id}
                to={`/interests/${i.id}`}
                className="card p-4 hover:border-accent/40 transition-colors group"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-sm font-medium text-text-1 group-hover:text-accent line-clamp-2">{i.title}</span>
                  <span className="shrink-0 text-[10px] text-text-3 bg-bg-3 px-1.5 py-0.5 rounded">{i.kind}</span>
                </div>
                {i.description && <p className="text-xs text-text-3 line-clamp-2">{i.description}</p>}
                <p className="text-xs text-text-3 mt-2">{formatRelative(i.updated_at)}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
