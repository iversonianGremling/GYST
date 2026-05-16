import { useEffect, useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DndContext, DragEndEvent, PointerSensor, TouchSensor, useDraggable, useSensor, useSensors } from '@dnd-kit/core'
import { Plus, Search, Pin, Trash2, FolderInput, Pencil } from 'lucide-react'
import { api, type Note, type Folder } from '@/api/client'
import { formatRelative } from '@/lib/utils'
import FolderTree from '@/components/FolderTree'
import MoveToFolderModal from '@/components/MoveToFolderModal'
import ContextMenu, { useContextMenu, type ContextMenuItem } from '@/components/ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'

function titleHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return h % 360
}

function NoteCard({ note, onDelete, onPin, onMoveToFolder }: {
  note: Note
  onDelete: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onMoveToFolder: (id: string) => void
}) {
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const longPress = useLongPress(openMenu)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: note.id,
    data: { type: 'note', id: note.id },
  })

  const hue = titleHue(note.title)
  const hasCover = !!note.cover_path
  const cs = note.cover_settings

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Open',
      icon: <Pencil size={14} />,
      onClick: () => { window.location.href = `/notes/${note.id}` },
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

  return (
    <>
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        {...longPress}
        onContextMenu={openMenu}
        style={{ opacity: isDragging ? 0.4 : 1 }}
        className="relative"
      >
        <Link
          to={`/notes/${note.id}`}
          draggable={false}
          className="block card overflow-hidden hover:border-accent/40 transition-colors group"
          onClick={(e) => { if (isDragging) e.preventDefault() }}
        >
          {/* Cover */}
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
            <h3 className="text-sm font-medium text-text-1 group-hover:text-accent leading-snug mb-1">
              {note.title}
            </h3>
            {note.description && (
              <p className="text-xs text-text-3 line-clamp-2 mb-1.5">{note.description}</p>
            )}
            <p className="text-xs text-text-3">{formatRelative(note.updated_at)}</p>
          </div>
        </Link>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </>
  )
}

export default function Notes() {
  const navigate = useNavigate()
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [movingId, setMovingId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const loadNotes = () => api.get<Note[]>('/notes').then(setNotes)
  const loadFolders = () => api.get<Folder[]>('/folders?entity_type=note').then(setFolders)

  useEffect(() => { loadNotes() }, [])
  useEffect(() => { loadFolders() }, [])

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const dragData = active.data.current
    if (dragData?.type === 'note') {
      await api.patch(`/notes/${active.id}`, { folder_id: over.id })
      loadNotes()
    }
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
        />
      ))}
    </div>
  )

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex h-full overflow-hidden">
        {/* Sidebar */}
        <aside className="w-48 shrink-0 border-r border-bg-3 bg-bg-2 overflow-y-auto p-3">
          <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wider mb-2 px-1">Folders</p>
          <FolderTree
            entityType="note"
            selectedId={folderId}
            onSelect={setFolderId}
            folders={folders}
            onRefresh={loadFolders}
          />
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-5 pb-3 flex items-center gap-3 border-b border-bg-3">
            <h1 className="text-lg font-semibold text-text-1 shrink-0">Notes</h1>
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
      </div>

      {movingId && (
        <MoveToFolderModal
          folders={folders}
          onSelect={moveToFolder}
          onClose={() => setMovingId(null)}
        />
      )}
    </DndContext>
  )
}
