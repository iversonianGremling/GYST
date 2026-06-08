import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Pin, Trash2, FolderInput, Pencil, Check, X } from 'lucide-react'
import { api, type Note, type Folder } from '@/api/client'
import { formatRelative } from '@/lib/utils'
import MoveToFolderModal from '@/components/MoveToFolderModal'
import ContextMenu, { useContextMenu, type ContextMenuItem } from '@/components/ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'

function titleHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return h % 360
}

function NoteCard({ note, onDelete, onPin, onMoveToFolder, onEdit }: {
  note: Note
  onDelete: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onMoveToFolder: (id: string) => void
  onEdit: (id: string, title: string, description: string | null) => void
}) {
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const longPress = useLongPress(openMenu)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(note.title)
  const [editDescription, setEditDescription] = useState(note.description ?? '')

  const hue = titleHue(note.title)
  const hasCover = !!note.cover_path
  const cs = note.cover_settings

  const startEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditTitle(note.title)
    setEditDescription(note.description ?? '')
    setEditing(true)
  }

  const commitEdit = () => {
    const title = editTitle.trim()
    if (title) onEdit(note.id, title, editDescription.trim() || null)
    setEditing(false)
  }

  const cancelEdit = () => {
    setEditTitle(note.title)
    setEditDescription(note.description ?? '')
    setEditing(false)
  }

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Open',
      icon: <Pencil size={14} />,
      onClick: () => { window.location.href = `/notes/${note.id}` },
    },
    {
      label: 'Edit',
      icon: <Pencil size={14} />,
      onClick: () => { setEditTitle(note.title); setEditDescription(note.description ?? ''); setEditing(true) },
    },
    {
      label: note.pinned ? 'Unpin' : 'Pin',
      icon: <Pin size={14} />,
      onClick: () => onPin(note.id, !note.pinned),
    },
    {
      label: 'Move to folder',
      icon: <FolderInput size={14} />,
      onClick: () => onMoveToFolder(note.id),
    },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => onDelete(note.id),
    },
  ]

  const cardInner = (
    <>
      <div
        className="relative h-32 overflow-hidden"
        style={
          hasCover
            ? undefined
            : { background: `linear-gradient(135deg, hsl(${hue},40%,22%), hsl(${(hue + 60) % 360},35%,14%))` }
        }
      >
        {hasCover && (
          <>
            <img
              src={note.cover_path!}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              style={{
                filter: `blur(${cs?.blur ?? 0}px) brightness(${cs?.brightness ?? 0.8})`,
                transform: `scale(${cs?.scale ?? 1.05})`,
                objectPosition: cs?.position ?? 'center',
              }}
            />
            <div
              className="absolute inset-0"
              style={{ background: cs?.overlay_color ?? '#000', opacity: cs?.overlay_opacity ?? 0.45 }}
            />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-1/70 to-transparent" />
        {note.pinned && (
          <div className="absolute top-2 right-2">
            <Pin size={13} className="text-accent drop-shadow" />
          </div>
        )}
      </div>

      <div className="p-3">
        {editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); commitEdit() }}
            onClick={(e) => e.stopPropagation()}
            className="space-y-1.5"
          >
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit() }}
              placeholder="Title…"
              className="input w-full py-0.5 text-sm h-6"
            />
            <input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit() }}
              placeholder="Description…"
              className="input w-full py-0.5 text-xs h-6"
            />
            <div className="flex gap-1.5 pt-0.5">
              <button type="submit" className="text-accent text-xs flex items-center gap-0.5">
                <Check size={11} /> Save
              </button>
              <button type="button" onClick={cancelEdit} className="text-text-3 text-xs flex items-center gap-0.5">
                <X size={11} /> Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <h3 className="text-sm font-medium text-text-1 group-hover:text-accent leading-snug mb-1">
              {note.title}
            </h3>
            {note.description && (
              <p className="text-xs text-text-3 line-clamp-2 mb-1.5">{note.description}</p>
            )}
            <p className="text-xs text-text-3">{formatRelative(note.updated_at)}</p>
          </>
        )}
      </div>
    </>
  )

  return (
    <>
      <div
        {...longPress}
        onContextMenu={openMenu}
        className="relative group/card"
      >
        {editing ? (
          <div className="card overflow-hidden">{cardInner}</div>
        ) : (
          <Link
            to={`/notes/${note.id}`}
            className="block card overflow-hidden hover:border-accent/40 transition-colors group"
          >
            {cardInner}
          </Link>
        )}

        {/* Hover action buttons */}
        {!editing && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity z-10">
            <button
              onClick={startEdit}
              title="Edit"
              className="p-1 rounded bg-bg-1/90 text-text-2 hover:text-text-1 hover:bg-bg-3 transition-colors"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(note.id) }}
              title="Delete"
              className="p-1 rounded bg-bg-1/90 text-text-3 hover:text-red-400 hover:bg-bg-3 transition-colors"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </>
  )
}

export default function Notes() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const folderId = searchParams.get('folder')

  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [search, setSearch] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)

  const loadNotes = () => api.get<Note[]>('/notes').then(setNotes)
  const loadFolders = () => api.get<Folder[]>('/folders?entity_type=note').then(setFolders)

  useEffect(() => { loadNotes() }, [])
  useEffect(() => { loadFolders() }, [])

  const folderPath = useMemo(() => {
    if (!folderId) return null
    const parts: string[] = []
    let cur: string | null = folderId
    while (cur) {
      const f = folders.find((x) => x.id === cur)
      if (!f) break
      parts.unshift(f.name)
      cur = f.parent_id
    }
    return parts.join(' / ')
  }, [folderId, folders])

  const visible = useMemo(() => {
    let list = notes
    if (folderId !== null) {
      list = list.filter((n) => n.folder_id === folderId)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (n) => n.title.toLowerCase().includes(q) || n.description?.toLowerCase().includes(q),
      )
    }
    return list
  }, [notes, folderId, search])

  const pinned = visible.filter((n) => n.pinned)
  const rest = visible.filter((n) => !n.pinned)

  const createNote = async () => {
    const n = await api.post<Note>('/notes', {
      title: 'Untitled',
      body_md: '',
      folder_id: folderId,
    })
    navigate(`/notes/${n.id}`)
  }

  const deleteNote = async (id: string) => {
    await api.del(`/notes/${id}`)
    setNotes((prev) => prev.filter((n) => n.id !== id))
  }

  const pinNote = async (id: string, pinned: boolean) => {
    await api.patch(`/notes/${id}`, { pinned })
    loadNotes()
  }

  const moveToFolder = async (fid: string | null) => {
    if (!movingId) return
    await api.patch(`/notes/${movingId}`, { folder_id: fid })
    setMovingId(null)
    loadNotes()
  }

  const editNote = async (id: string, title: string, description: string | null) => {
    await api.patch(`/notes/${id}`, { title, description })
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, title, description } : n))
  }

  const Grid = ({ items }: { items: Note[] }) => (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
      {items.map((n) => (
        <NoteCard
          key={n.id}
          note={n}
          onDelete={deleteNote}
          onPin={pinNote}
          onMoveToFolder={(id) => setMovingId(id)}
          onEdit={editNote}
        />
      ))}
    </div>
  )

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-5 pb-3 flex items-center gap-3 border-b border-bg-3">
          <h1 className="text-lg font-semibold text-text-1 shrink-0">
            Notes{folderPath && <><span className="font-normal text-text-3 mx-1">/</span>{folderPath}</>}
          </h1>
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none" />
            <input
              className="input w-full pl-8 py-1.5 text-sm"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button className="btn-primary flex items-center gap-1.5 text-sm ml-auto shrink-0" onClick={createNote}>
            <Plus size={15} /> New note
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {visible.length === 0 ? (
            <div className="text-sm text-text-3 text-center py-16">
              {search ? 'No results.' : 'No notes yet.'}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <section>
                  <h2 className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Pin size={11} /> Pinned
                  </h2>
                  <Grid items={pinned} />
                </section>
              )}
              {rest.length > 0 && (
                <section>
                  {pinned.length > 0 && (
                    <h2 className="text-xs font-semibold text-text-3 uppercase tracking-wider mb-3">Notes</h2>
                  )}
                  <Grid items={rest} />
                </section>
              )}
            </>
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
