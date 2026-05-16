import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onClick: () => void
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handle = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('touchstart', handle)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('touchstart', handle)
    }
  }, [onClose])

  // Clamp to viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 200),
    left: Math.min(x, window.innerWidth - 180),
    zIndex: 9999,
  }

  return createPortal(
    <div
      ref={ref}
      style={style}
      className="w-44 rounded-lg shadow-xl border border-bg-3 bg-bg-2 py-1 text-sm"
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors hover:bg-bg-3 ${
            item.danger ? 'text-danger' : 'text-text-1'
          }`}
          onClick={() => { item.onClick(); onClose() }}
        >
          {item.icon && <span className="shrink-0 text-text-3">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

// Hook to wire context-menu state into a container
import { useState, useCallback } from 'react'

interface MenuState { x: number; y: number }

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null)

  const open = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    const { clientX, clientY } =
      'touches' in e ? e.touches[0] : (e as React.MouseEvent)
    setMenu({ x: clientX, y: clientY })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  return { menu, open, close }
}
