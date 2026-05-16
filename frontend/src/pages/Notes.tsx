import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, type Note } from '@/api/client'
import { formatRelative } from '@/lib/utils'

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [search, setSearch] = useState('')
  const [searchParams] = useSearchParams()
  const interestId = searchParams.get('interest_id')

  useEffect(() => {
    const url = interestId ? `/notes?interest_id=${interestId}` : '/notes'
    api.get<Note[]>(url).then(setNotes)
  }, [interestId])

  const filtered = search
    ? notes.filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
    : notes

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Notes</h1>
        <Link to="/notes/new" className="btn-primary flex items-center gap-1.5"><Plus size={15} /> New note</Link>
      </div>

      <input
        className="input w-full mb-4"
        placeholder="Search notes…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="space-y-1.5">
        {filtered.length === 0 ? (
          <p className="text-sm text-text-3">No notes found.</p>
        ) : (
          filtered.map((n) => (
            <Link
              key={n.id}
              to={`/notes/${n.id}`}
              className="card flex items-center justify-between px-4 py-3 hover:border-accent/40 transition-colors"
            >
              <span className="text-sm text-text-1">{n.title}</span>
              <span className="text-xs text-text-3">{formatRelative(n.updated_at)}</span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
