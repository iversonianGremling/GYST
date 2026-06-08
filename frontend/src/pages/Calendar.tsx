import { useEffect, useState } from 'react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  isToday, parseISO, isSameDay, addMonths, subMonths,
} from 'date-fns'
import { Pencil, Trash2, X } from 'lucide-react'
import { api, type CalendarEvent } from '@/api/client'

type EventForm = { title: string; starts_at: string; ends_at: string; body_md: string; color: string; all_day: boolean }

const EMPTY_FORM: EventForm = { title: '', starts_at: '', ends_at: '', body_md: '', color: '', all_day: false }

export default function Calendar() {
  const [current,  setCurrent]  = useState(new Date())
  const [events,   setEvents]   = useState<CalendarEvent[]>([])
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [form,     setForm]     = useState<EventForm | null>(null)   // null = closed, EMPTY_FORM = new, filled = edit
  const [editId,   setEditId]   = useState<string | null>(null)

  useEffect(() => {
    const from_ = startOfMonth(current).toISOString()
    const to    = endOfMonth(current).toISOString()
    api.get<CalendarEvent[]>(`/events?from_=${from_}&to=${to}`).then(setEvents)
  }, [current])

  const days     = eachDayOfInterval({ start: startOfMonth(current), end: endOfMonth(current) })
  const firstDow = startOfMonth(current).getDay()
  const eventsOn = (day: Date) => events.filter((e) => isSameDay(parseISO(e.starts_at), day))

  const openNew = () => {
    setEditId(null)
    setSelected(null)
    setForm({ ...EMPTY_FORM })
  }

  const openEdit = (e: CalendarEvent) => {
    setSelected(null)
    setEditId(e.id)
    setForm({
      title: e.title,
      starts_at: e.starts_at.slice(0, 16),   // datetime-local format
      ends_at: e.ends_at ? e.ends_at.slice(0, 16) : '',
      body_md: e.body_md ?? '',
      color: e.color ?? '',
      all_day: e.all_day,
    })
  }

  const submitForm = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form) return
    const payload = {
      ...form,
      ends_at: form.ends_at || null,
      color: form.color || null,
    }
    if (editId) {
      const updated = await api.patch<CalendarEvent>(`/events/${editId}`, payload)
      setEvents((prev) => prev.map((e) => e.id === editId ? updated : e))
    } else {
      const created = await api.post<CalendarEvent>('/events', payload)
      setEvents((prev) => [...prev, created])
    }
    setForm(null)
    setEditId(null)
  }

  const deleteEvent = async (id: string) => {
    await api.del(`/events/${id}`)
    setEvents((prev) => prev.filter((e) => e.id !== id))
    setSelected(null)
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <button className="btn-ghost" onClick={() => setCurrent(subMonths(current, 1))}>‹</button>
          <h2 className="text-lg font-semibold text-text-1 min-w-[140px] sm:min-w-[180px] text-center">
            {format(current, 'MMMM yyyy')}
          </h2>
          <button className="btn-ghost" onClick={() => setCurrent(addMonths(current, 1))}>›</button>
        </div>
        <div className="flex gap-2 ml-auto">
          <button className="btn-ghost text-sm" onClick={() => setCurrent(new Date())}>Today</button>
          <button className="btn-primary" onClick={openNew}>+ Event</button>
        </div>
      </div>

      {/* Create / edit form */}
      {form !== null && (
        <form onSubmit={submitForm} className="card p-4 mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{editId ? 'Edit event' : 'New event'}</h3>
            <button type="button" onClick={() => { setForm(null); setEditId(null) }} className="text-text-3 hover:text-text-1">
              <X size={16} />
            </button>
          </div>
          <div className="flex gap-3 flex-wrap items-end">
            <div className="flex-1 min-w-[160px]">
              <label className="text-xs text-text-3 mb-1 block">Title</label>
              <input className="input w-full" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
            <div>
              <label className="text-xs text-text-3 mb-1 block">Start</label>
              <input type="datetime-local" className="input" value={form.starts_at}
                onChange={(e) => setForm({ ...form, starts_at: e.target.value })} required />
            </div>
            <div>
              <label className="text-xs text-text-3 mb-1 block">End <span className="text-text-3">(optional)</span></label>
              <input type="datetime-local" className="input" value={form.ends_at}
                onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-text-3 mb-1 block">Color</label>
              <input type="color" className="h-[34px] w-10 rounded cursor-pointer bg-bg-3 border border-bg-4"
                value={form.color || '#7c6af7'}
                onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
          </div>
          <div>
            <label className="text-xs text-text-3 mb-1 block">Notes</label>
            <textarea className="input w-full resize-none" rows={2} value={form.body_md}
              onChange={(e) => setForm({ ...form, body_md: e.target.value })}
              placeholder="Optional description…" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">{editId ? 'Save' : 'Create'}</button>
            <button type="button" className="btn-ghost" onClick={() => { setForm(null); setEditId(null) }}>Cancel</button>
          </div>
        </form>
      )}

      {/* Grid headers */}
      <div className="grid grid-cols-7 mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-xs text-text-3 py-1">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px bg-bg-3 rounded-lg overflow-hidden border border-bg-3">
        {Array.from({ length: firstDow }).map((_, i) => (
          <div key={`pad-${i}`} className="bg-bg-1 min-h-[80px]" />
        ))}
        {days.map((day) => {
          const dayEvents = eventsOn(day)
          return (
            <div key={day.toISOString()} className="bg-bg-2 min-h-[80px] p-1.5">
              <span className={`text-xs font-medium block text-right mb-1 w-6 h-6 flex items-center justify-center ml-auto rounded-full
                ${isToday(day) ? 'bg-accent text-white' : 'text-text-2'}`}>
                {format(day, 'd')}
              </span>
              {dayEvents.slice(0, 3).map((e) => (
                <button
                  key={e.id}
                  onClick={() => setSelected(e)}
                  className="block w-full text-left text-[10px] px-1 py-0.5 rounded truncate mb-0.5 transition-opacity hover:opacity-80"
                  style={{ background: (e.color || 'var(--color-accent)') + '33', color: e.color || 'var(--color-accent)' }}
                >
                  {e.title}
                </button>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-text-3">+{dayEvents.length - 3} more</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Event detail popover */}
      {selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="card p-5 w-full max-w-sm space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-text-1">{selected.title}</h3>
                <p className="text-sm text-text-2 mt-0.5">{format(parseISO(selected.starts_at), 'PPPp')}</p>
                {selected.ends_at && (
                  <p className="text-xs text-text-3">until {format(parseISO(selected.ends_at), 'p')}</p>
                )}
              </div>
              {selected.color && (
                <div className="w-3 h-3 rounded-full shrink-0 mt-1" style={{ background: selected.color }} />
              )}
            </div>
            {selected.body_md && <p className="text-sm text-text-2">{selected.body_md}</p>}
            <div className="flex items-center gap-2 pt-1 border-t border-bg-3">
              <button className="btn-ghost text-sm flex items-center gap-1.5" onClick={() => openEdit(selected)}>
                <Pencil size={13} /> Edit
              </button>
              <button
                className="btn-ghost text-sm flex items-center gap-1.5 text-danger hover:text-danger hover:bg-danger/10"
                onClick={() => deleteEvent(selected.id)}
              >
                <Trash2 size={13} /> Delete
              </button>
              <button className="btn-ghost text-sm ml-auto" onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
