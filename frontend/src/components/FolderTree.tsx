import { useState } from 'react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { ChevronRight, Folder as FolderIcon, FolderOpen, Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { api, type Folder } from '@/api/client'
import ContextMenu, { useContextMenu, type ContextMenuItem } from './ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'

const COLORS = ['#6b7280', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']

interface FolderNodeProps {
  folder: Folder
  all: Folder[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRefresh: () => void
  depth: number
}

function FolderNode({ folder, all, selectedId, onSelect, onRefresh, depth }: FolderNodeProps) {
  const children = all.filter((f) => f.parent_id === folder.id)
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const longPress = useLongPress(openMenu)

  const { setNodeRef: dropRef, isOver } = useDroppable({ id: folder.id })
  const { attributes, listeners, setNodeRef: dragRef, isDragging } = useDraggable({
    id: `folder-${folder.id}`,
    data: { type: 'folder', id: folder.id },
  })

  const isSelected = selectedId === folder.id

  const rename = async () => {
    if (name.trim() && name.trim() !== folder.name) {
      await api.patch(`/folders/${folder.id}`, { name: name.trim() })
      onRefresh()
    }
    setEditing(false)
  }

  const remove = async () => {
    await api.del(`/folders/${folder.id}`)
    if (selectedId === folder.id) onSelect(null)
    onRefresh()
  }

  const setColor = async (color: string) => {
    await api.patch(`/folders/${folder.id}`, { color })
    onRefresh()
  }

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Rename',
      icon: <Pencil size={14} />,
      onClick: () => setEditing(true),
    },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: remove,
    },
  ]

  const indent = depth * 12

  return (
    <div style={{ opacity: isDragging ? 0.4 : 1 }}>
      <div
        ref={(el) => { dropRef(el); dragRef(el) }}
        {...attributes}
        {...listeners}
        {...longPress}
        onContextMenu={openMenu}
        onClick={() => { onSelect(isSelected ? null : folder.id); setOpen((v) => !v) }}
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm transition-colors group
          ${isSelected ? 'bg-accent/15 text-accent' : 'hover:bg-bg-3 text-text-2'}
          ${isOver ? 'ring-1 ring-accent/50 bg-accent/10' : ''}`}
        style={{ paddingLeft: 8 + indent }}
      >
        <span className="shrink-0 transition-transform" style={{ transform: open ? 'rotate(90deg)' : undefined, visibility: children.length ? 'visible' : 'hidden' }}>
          <ChevronRight size={13} />
        </span>
        {open && children.length
          ? <FolderOpen size={15} style={{ color: folder.color ?? undefined }} />
          : <FolderIcon size={15} style={{ color: folder.color ?? undefined }} />
        }
        {editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); rename() }}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 flex-1"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={rename}
              className="input flex-1 py-0 text-sm h-6"
            />
            <button type="submit" className="text-accent"><Check size={13} /></button>
            <button type="button" onClick={() => { setEditing(false); setName(folder.name) }} className="text-text-3"><X size={13} /></button>
          </form>
        ) : (
          <span className="flex-1 truncate">{folder.name}</span>
        )}

        {/* Color dots — visible on hover */}
        <div
          className="hidden group-hover:flex items-center gap-0.5 ml-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {COLORS.map((c) => (
            <button
              key={c}
              className="w-2.5 h-2.5 rounded-full border border-bg-3"
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}

      {open && children.length > 0 && (
        <div>
          {children
            .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
            .map((child) => (
              <FolderNode
                key={child.id}
                folder={child}
                all={all}
                selectedId={selectedId}
                onSelect={onSelect}
                onRefresh={onRefresh}
                depth={depth + 1}
              />
            ))}
        </div>
      )}
    </div>
  )
}

interface Props {
  entityType: string
  selectedId: string | null
  onSelect: (id: string | null) => void
  folders: Folder[]
  onRefresh: () => void
}

export default function FolderTree({ entityType, selectedId, onSelect, folders, onRefresh }: Props) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const roots = folders.filter((f) => f.parent_id === null)

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    await api.post('/folders', { name: newName.trim(), entity_type: entityType })
    setNewName('')
    setCreating(false)
    onRefresh()
  }

  return (
    <div className="flex flex-col gap-0.5">
      <button
        className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer select-none text-sm transition-colors
          ${selectedId === null ? 'bg-accent/15 text-accent' : 'hover:bg-bg-3 text-text-2'}`}
        onClick={() => onSelect(null)}
      >
        <FolderOpen size={15} />
        All
      </button>

      {roots
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((f) => (
          <FolderNode
            key={f.id}
            folder={f}
            all={folders}
            selectedId={selectedId}
            onSelect={onSelect}
            onRefresh={onRefresh}
            depth={0}
          />
        ))}

      {creating ? (
        <form onSubmit={createFolder} className="flex items-center gap-1 px-2 py-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => { if (!newName.trim()) setCreating(false) }}
            placeholder="Folder name…"
            className="input flex-1 py-0 text-sm h-6"
          />
          <button type="submit" className="text-accent"><Check size={13} /></button>
          <button type="button" onClick={() => setCreating(false)} className="text-text-3"><X size={13} /></button>
        </form>
      ) : (
        <button
          className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-text-3 hover:text-text-2 hover:bg-bg-3 transition-colors"
          onClick={() => setCreating(true)}
        >
          <Plus size={13} /> New folder
        </button>
      )}
    </div>
  )
}
