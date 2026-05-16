import { createPortal } from 'react-dom'
import { Folder as FolderIcon, X } from 'lucide-react'
import { type Folder } from '@/api/client'

interface Props {
  folders: Folder[]
  onSelect: (folderId: string | null) => void
  onClose: () => void
}

function buildTree(
  folders: Folder[],
  parentId: string | null,
  depth: number,
  onSelect: (id: string | null) => void,
): React.ReactNode[] {
  return folders
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
    .flatMap((f) => [
      <button
        key={f.id}
        className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-bg-3 text-text-1 transition-colors"
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => onSelect(f.id)}
      >
        <FolderIcon size={14} style={{ color: f.color ?? undefined }} />
        {f.name}
      </button>,
      ...buildTree(folders, f.id, depth + 1, onSelect),
    ])
}

export default function MoveToFolderModal({ folders, onSelect, onClose }: Props) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-2 border border-bg-3 rounded-xl shadow-2xl w-72 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-bg-3">
          <span className="text-sm font-medium text-text-1">Move to folder</span>
          <button onClick={onClose} className="text-text-3 hover:text-text-1"><X size={16} /></button>
        </div>
        <div className="max-h-72 overflow-y-auto py-1">
          <button
            className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-bg-3 text-text-2 transition-colors"
            onClick={() => onSelect(null)}
          >
            <FolderIcon size={14} />
            No folder (root)
          </button>
          {buildTree(folders, null, 0, onSelect)}
        </div>
      </div>
    </div>,
    document.body,
  )
}
