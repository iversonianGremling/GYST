import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Archive as ArchiveIcon } from 'lucide-react'
import { api, type Interest, type Folder } from '@/api/client'
import ItemCard from '@/components/ItemCard'
import MoveToFolderModal from '@/components/MoveToFolderModal'

const KIND = 'content'

export default function Content() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const folderId = searchParams.get('folder')

  const [interests, setInterests] = useState<Interest[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ title: '', description: '' })
  const [movingId, setMovingId] = useState<string | null>(null)

  const loadInterests = () =>
    api.get<Interest[]>(`/interests?kind=${KIND}&archived=${showArchived}`).then(setInterests)
  const loadFolders = () =>
    api.get<Folder[]>(`/folders?entity_type=${KIND}`).then(setFolders)

  useEffect(() => { loadInterests() }, [showArchived])
  useEffect(() => { loadFolders() }, [])

  const visible = useMemo(() => {
    let list = interests
    if (folderId !== null) {
      list = list.filter((i) => i.folder_id === folderId)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (i) => i.title.toLowerCase().includes(q) || i.description?.toLowerCase().includes(q),
      )
    }
    return list
  }, [interests, folderId, search])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const i = await api.post<Interest>('/interests', { ...form, kind: KIND, folder_id: folderId })
    setCreating(false)
    setForm({ title: '', description: '' })
    navigate(`/interests/${i.id}`)
  }

  const deleteItem = async (id: string) => {
    await api.del(`/interests/${id}`)
    setInterests((prev) => prev.filter((i) => i.id !== id))
  }

  const archiveItem = async (id: string) => {
    const item = interests.find((i) => i.id === id)!
    await api.patch(`/interests/${id}`, { archived: !item.archived })
    loadInterests()
  }

  const moveToFolder = async (fid: string | null) => {
    if (!movingId) return
    await api.patch(`/interests/${movingId}`, { folder_id: fid })
    setMovingId(null)
    loadInterests()
  }

  const editItem = async (id: string, title: string, description: string | null) => {
    await api.patch(`/interests/${id}`, { title, description })
    setInterests((prev) => prev.map((i) => i.id === id ? { ...i, title, description } : i))
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-5 pb-3 flex items-center gap-3 border-b border-bg-3">
          <h1 className="text-lg font-semibold text-text-1 shrink-0">Content</h1>
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
            <input
              className="input w-full pl-8 py-1.5 text-sm"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className={`btn-ghost text-xs flex items-center gap-1.5 ${showArchived ? 'text-accent' : ''}`}
            onClick={() => setShowArchived((v) => !v)}
          >
            <ArchiveIcon size={14} /> {showArchived ? 'Hide archived' : 'Archived'}
          </button>
          <button className="btn-primary flex items-center gap-1.5 text-sm ml-auto shrink-0" onClick={() => setCreating(true)}>
            <Plus size={15} /> New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {creating && (
            <form onSubmit={create} className="card p-4 mb-5 space-y-3">
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
                  <label className="text-xs text-text-3 mb-1 block">Description</label>
                  <input
                    className="input w-full"
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional…"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn-primary">Create</button>
                <button type="button" className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              </div>
            </form>
          )}

          {visible.length === 0 ? (
            <div className="text-sm text-text-3 text-center py-16">
              {search ? 'No results.' : 'No content yet — add some!'}
            </div>
          ) : (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              {visible.map((i) => (
                <ItemCard
                  key={i.id}
                  interest={i}
                  onDelete={deleteItem}
                  onArchive={archiveItem}
                  onMoveToFolder={(id) => setMovingId(id)}
                  onEdit={editItem}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {movingId && (
        <MoveToFolderModal
          folders={folders}
          onSelect={moveToFolder}
          onClose={() => setMovingId(null)}
        />
      )}
    </>
  )
}
