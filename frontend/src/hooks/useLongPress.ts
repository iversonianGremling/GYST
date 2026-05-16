import { useCallback, useRef } from 'react'

export function useLongPress(
  onLongPress: (e: React.TouchEvent | React.MouseEvent) => void,
  delay = 400,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  const start = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      fired.current = false
      timer.current = setTimeout(() => {
        fired.current = true
        onLongPress(e)
      }, delay)
    },
    [onLongPress, delay],
  )

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return {
    onMouseDown: start,
    onMouseUp: cancel,
    onMouseLeave: cancel,
    onTouchStart: start,
    onTouchEnd: cancel,
    onTouchMove: cancel,
    onClick: (e: React.MouseEvent) => {
      if (fired.current) e.preventDefault()
    },
  }
}
