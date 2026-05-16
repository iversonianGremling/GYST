import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, type Interest } from '@/api/client'
import { formatRelative } from '@/lib/utils'

const KIND_LABELS: Record<string, string> = {
  project: 'Project',
  content: 'Content',
}

export default function Interests() {
  const [interests, setInterests] = useState<Interest[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', kind: 'project', description: '' })
  const navigate = useNavigate()

  const load = () => api.get<Interest[]>('/interests').then(setInterests)
  useEffect(() => { load() }, [])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const i = await api.post<Interest>('/interests', form)
    setCreating(false)
    setForm({ title: '', kind: 'project', description: '' })
    navigate(`/interests/${i.id}`)
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Interests</h1>
        <button className="btn-primary flex items-center gap-1.5" onClick={() => setCreating(true)}><Plus size={15} /> New</button>
      </div>

      {creating && (
        <form onSubmit={create} className="card p-4 mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-text-3 mb-1 block">Title</label>
              <input
                className="input w-full"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                autoFocus
                required
              />
            </div>
            <div>
              <label className="text-xs text-text-3 mb-1 block">Kind</label>
              <select
                className="input w-full"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value })}
              >
                <option value="project">Project</option>
                <option value="content">Content</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-text-3 mb-1 block">Description</label>
            <input
              className="input w-full"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional…"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary">Create</button>
            <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {interests.map((i) => (
          <Link
            key={i.id}
            to={`/interests/${i.id}`}
            className="card p-4 hover:border-accent/40 transition-colors group"
          >
            <div className="flex items-start justify-between gap-1 mb-1.5">
              <span className="text-sm font-medium text-text-1 group-hover:text-accent leading-tight">
                {i.title}
              </span>
              <span className="text-[10px] text-text-3 bg-bg-3 px-1.5 py-0.5 rounded shrink-0">
                {KIND_LABELS[i.kind] ?? i.kind}
              </span>
            </div>
            {i.description && (
              <p className="text-xs text-text-3 line-clamp-2">{i.description}</p>
            )}
            <p className="text-xs text-text-3 mt-2">{formatRelative(i.updated_at)}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
