import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Folder as FolderIcon, FolderOpen, Plus, Check, X, Pencil, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api, type Folder } from '@/api/client'
import ContextMenu, { useContextMenu, type ContextMenuItem } from './ContextMenu'

interface SidebarItem {
  id: string
  title: string
  folder_id: string | null
}

interface NodeProps {
  folder: Folder
  all: Folder[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onRefresh: () => void
  depth: number
  items: SidebarItem[]
  itemLink: (id: string) => string
}

function hasSelectedDescendant(folderId: string, all: Folder[], selectedId: string | null): boolean {
  if (!selectedId) return false
  return all
    .filter((f) => f.parent_id === folderId)
    .some((child) => child.id === selectedId || hasSelectedDescendant(child.id, all, selectedId))
}

function FolderNode({ folder, all, selectedId, onSelect, onRefresh, depth, items, itemLink }: NodeProps) {
  const children = all
    .filter((f) => f.parent_id === folder.id)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const folderItems = items.filter((i) => i.folder_id === folder.id)
  const hasChildren = children.length > 0 || folderItems.length > 0

  const [childOpen, setChildOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(folder.name)
  const { menu, open: openMenu, close: closeMenu } = useContextMenu()
  const isSelected = selectedId === folder.id
  const hasSelectedChild = !childOpen && hasSelectedDescendant(folder.id, all, selectedId)
  const showAsActive = isSelected || hasSelectedChild

  const rename = async () => {
    if (name.trim() && name.trim() !== folder.name) {
      await api.patch(`/folders/${folder.id}`, { name: name.trim() })
      onRefresh()
    }
    setEditing(false)
  }

  const remove = async () => {
    await api.del(`/folders/${folder.id}`)
    if (isSelected) onSelect(null)
    onRefresh()
  }

  const menuItems: ContextMenuItem[] = [
    { label: 'Rename', icon: <Pencil size={14} />, onClick: () => setEditing(true) },
    { label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: remove },
  ]

  const pl = 24 + depth * 12

  return (
    <>
      <button
        onContextMenu={openMenu}
        onClick={() => {
          onSelect(folder.id)
          if (hasChildren) setChildOpen((v) => !v)
        }}
        className={`sidebar-item w-full${showAsActive ? ' active' : ''}`}
        style={{ paddingLeft: pl, paddingTop: 5, paddingBottom: 5 }}
      >
        <span
          className="shrink-0 transition-transform"
          style={{
            transform: childOpen && hasChildren ? 'rotate(90deg)' : undefined,
            visibility: hasChildren ? 'visible' : 'hidden',
            width: 12,
          }}
        >
          <ChevronRight size={11} />
        </span>
        {childOpen && hasChildren
          ? <FolderOpen size={13} className="shrink-0" style={{ color: folder.color ?? undefined }} />
          : <FolderIcon size={13} className="shrink-0" style={{ color: folder.color ?? undefined }} />}
        {editing ? (
          <form
            onSubmit={(e) => { e.preventDefault(); rename() }}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 flex-1"
          >
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={rename}
              className="input flex-1 py-0 text-xs h-5" />
            <button type="submit" className="text-accent"><Check size={11} /></button>
            <button type="button" onClick={() => { setEditing(false); setName(folder.name) }} className="text-text-3"><X size={11} /></button>
          </form>
        ) : (
          <span className="flex-1 truncate text-xs">{folder.name}</span>
        )}
      </button>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}

      {childOpen && (
        <>
          {children.map((child) => (
            <FolderNode key={child.id} folder={child} all={all} selectedId={selectedId}
              onSelect={onSelect} onRefresh={onRefresh} depth={depth + 1}
              items={items} itemLink={itemLink} />
          ))}
          {folderItems.map((item) => (
            <NavLink
              key={item.id}
              to={itemLink(item.id)}
              className={({ isActive }) => `sidebar-item w-full${isActive ? ' active' : ''}`}
              style={{ paddingLeft: pl + 16, paddingTop: 4, paddingBottom: 4 }}
            >
              <span style={{ width: 12, visibility: 'hidden', flexShrink: 0 }}><ChevronRight size={11} /></span>
              <span className="w-2 h-2 rounded-full bg-current opacity-40 shrink-0" />
              <span className="flex-1 truncate text-xs">{item.title}</span>
            </NavLink>
          ))}
        </>
      )}
    </>
  )
}

interface Props {
  path: string
  label: string
  Icon: LucideIcon
  entityType: string
  open: boolean
  onToggle: () => void
  itemsApiPath?: string
  itemLink?: (id: string) => string
}

export default function SidebarFolderSection({
  path, label, Icon, entityType, open, onToggle, itemsApiPath, itemLink,
}: Props) {
  const location = useLocation()
  const navigate = useNavigate()

  const isOnPath = location.pathname === path
  const selectedId = isOnPath ? new URLSearchParams(location.search).get('folder') : null

  const [folders, setFolders] = useState<Folder[]>([])
  const [items, setItems] = useState<SidebarItem[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  const loadFolders = () =>
    api.get<Folder[]>(`/folders?entity_type=${entityType}`).then(setFolders)

  const loadItems = () => {
    if (!itemsApiPath || !itemLink) return
    api.get<SidebarItem[]>(itemsApiPath).then(setItems).catch(() => {})
  }

  useEffect(() => {
    if (open) { loadFolders(); loadItems() }
  }, [open])

  // Refresh items when navigating back to this section
  useEffect(() => {
    if (open && isOnPath) { loadFolders(); loadItems() }
  }, [location.pathname, location.search])

  const onSelect = (id: string | null) =>
    id ? navigate(`${path}?folder=${id}`) : navigate(path)

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    await api.post('/folders', { name: newName.trim(), entity_type: entityType })
    setNewName('')
    setCreating(false)
    loadFolders()
  }

  const roots = folders
    .filter((f) => f.parent_id === null)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))

  const rootItems = items.filter((i) => i.folder_id === null)

  const handleHeaderClick = () => {
    if (!isOnPath) navigate(path)
    onToggle()
  }

  return (
    <>
      <button
        className={`sidebar-item w-full${isOnPath ? ' active' : ''}`}
        onClick={handleHeaderClick}
      >
        <Icon size={17} strokeWidth={1.75} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronRight size={13} className="shrink-0 transition-transform"
          style={{ transform: open ? 'rotate(90deg)' : undefined }} />
      </button>

      {open && (
        <div className="space-y-0">
          {roots.map((f) => (
            <FolderNode key={f.id} folder={f} all={folders} selectedId={selectedId}
              onSelect={onSelect} onRefresh={loadFolders} depth={0}
              items={items} itemLink={itemLink ?? ((id) => `${path}/${id}`)} />
          ))}

          {rootItems.map((item) => (
            <NavLink
              key={item.id}
              to={(itemLink ?? ((id) => `${path}/${id}`))(item.id)}
              className={({ isActive }) => `sidebar-item w-full${isActive ? ' active' : ''}`}
              style={{ paddingLeft: 28, paddingTop: 4, paddingBottom: 4 }}
            >
              <span style={{ width: 12, visibility: 'hidden', flexShrink: 0 }}><ChevronRight size={11} /></span>
              <span className="w-2 h-2 rounded-full bg-current opacity-40 shrink-0" />
              <span className="flex-1 truncate text-xs">{item.title}</span>
            </NavLink>
          ))}

          {creating ? (
            <form onSubmit={createFolder} className="flex items-center gap-1"
              style={{ paddingLeft: 28, paddingRight: 8, paddingTop: 3, paddingBottom: 3 }}>
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
                onBlur={() => { if (!newName.trim()) setCreating(false) }}
                placeholder="Folder name…" className="input flex-1 py-0 text-xs h-5" />
              <button type="submit" className="text-accent"><Check size={11} /></button>
              <button type="button" onClick={() => setCreating(false)} className="text-text-3"><X size={11} /></button>
            </form>
          ) : (
            <button className="sidebar-item w-full text-text-3 hover:text-text-2 text-xs"
              style={{ paddingLeft: 28, paddingTop: 4, paddingBottom: 4 }}
              onClick={() => setCreating(true)}>
              <Plus size={11} /> New folder
            </button>
          )}
        </div>
      )}
    </>
  )
}
