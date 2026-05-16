import { useDraggable } from '@dnd-kit/core'
import { Link } from 'react-router-dom'
import { Archive, Pencil, Trash2, FolderInput } from 'lucide-react'
import { type Interest } from '@/api/client'
import { formatRelative } from '@/lib/utils'
import ContextMenu, { useContextMenu, type ContextMenuItem } from './ContextMenu'
import { useLongPress } from '@/hooks/useLongPress'

interface Props {
  interest: Interest
  onDelete: (id: string) => void
  onArchive: (id: string) => void
  onMoveToFolder: (id: string) => void
}

function titleHue(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return h % 360
}

export default function ItemCard({ interest, onDelete, onArchive, onMoveToFolder }: Props) {
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const longPress = useLongPress(openMenu)

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: interest.id,
    data: { type: 'interest', id: interest.id },
  })

  const hue = titleHue(interest.title)
  const hasCover = !!interest.cover_path
  const cs = interest.cover_settings

  const menuItems: ContextMenuItem[] = [
    {
      label: 'Open',
      icon: <Pencil size={14} />,
      onClick: () => { window.location.href = `/interests/${interest.id}` },
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
          to={`/interests/${interest.id}`}
          draggable={false}
          className="block card overflow-hidden hover:border-accent/40 transition-colors group"
          onClick={(e) => { if (isDragging) e.preventDefault() }}
        >
          {/* Cover / gradient */}
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
            <div className="flex items-start gap-1.5 mb-1">
              <span className="text-sm font-medium text-text-1 group-hover:text-accent leading-snug flex-1">
                {interest.title}
              </span>
            </div>
            {interest.description && (
              <p className="text-xs text-text-3 line-clamp-2 mb-1.5">{interest.description}</p>
            )}
            <p className="text-xs text-text-3">{formatRelative(interest.updated_at)}</p>
          </div>
        </Link>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />
      )}
    </>
  )
}
