import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Archive, Pencil, Trash2, FolderInput, Check, X } from 'lucide-react'
import { type Interest } from '@/api/client'
import { formatRelative } from '@/lib/utils'
import ContextMenu, { useContextMenu, type ContextMenuItem } from './ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'

interface Props {
  interest: Interest
  onDelete: (id: string) => void
  onArchive: (id: string) => void
  onMoveToFolder: (id: string) => void
  onEdit: (id: string, title: string, description: string | null) => void
}

function titleHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return h % 360
}

export default function ItemCard({ interest, onDelete, onArchive, onMoveToFolder, onEdit }: Props) {
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const longPress = useLongPress(openMenu)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(interest.title)
  const [editDescription, setEditDescription] = useState(interest.description ?? '')

  const hue = titleHue(interest.title)
  const hasCover = !!interest.cover_path
  const cs = interest.cover_settings

  const startEdit = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditTitle(interest.title)
    setEditDescription(interest.description ?? '')
    setEditing(true)
  }

  const commitEdit = () => {
    const title = editTitle.trim()
    if (title) onEdit(interest.id, title, editDescription.trim() || null)
    setEditing(false)
  }

  const cancelEdit = () => {
    setEditTitle(interest.title)
    setEditDescription(interest.description ?? '')
    setEditing(false)
  }

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Open',
      icon: <Pencil size={14} />,
      onClick: () => { window.location.href = `/interests/${interest.id}` },
    },
    {
      label: 'Edit',
      icon: <Pencil size={14} />,
      onClick: () => { setEditTitle(interest.title); setEditDescription(interest.description ?? ''); setEditing(true) },
    },
    {
      label: 'Move to folder',
      icon: <FolderInput size={14} />,
      onClick: () => onMoveToFolder(interest.id),
    },
    {
      label: interest.archived ? 'Unarchive' : 'Archive',
      icon: <Archive size={14} />,
      onClick: () => onArchive(interest.id),
    },
    {
      label: 'Delete',
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: () => onDelete(interest.id),
    },
  ]

  const cardInner = (
    <>
      <div
        className="relative h-28 overflow-hidden"
        style={
          hasCover
            ? undefined
            : { background: `linear-gradient(135deg, hsl(${hue},55%,28%), hsl(${(hue + 40) % 360},45%,18%))` }
        }
      >
        {hasCover && (
          <>
            <img
              src={interest.cover_path!}
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
              style={{
                background: cs?.overlay_color ?? '#000',
                opacity: cs?.overlay_opacity ?? 0.45,
              }}
            />
          </>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-bg-1/80 to-transparent" />
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
            <div className="flex items-start gap-1.5 mb-1">
              <span className="text-sm font-medium text-text-1 group-hover:text-accent leading-snug flex-1">
                {interest.title}
              </span>
            </div>
            {interest.description && (
              <p className="text-xs text-text-3 line-clamp-2 mb-1.5">{interest.description}</p>
            )}
            <p className="text-xs text-text-3">{formatRelative(interest.updated_at)}</p>
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
            to={`/interests/${interest.id}`}
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
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(interest.id) }}
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
