// Bar ruler + loop brace (Ableton-style). Drag across the ruler to set a loop
// region (snaps to the bar); drag the brace body to move it or its edges to
// resize. Clicking without dragging moves the caret. Shares the grid's time
// axis via pxPerTick + scrollLeft.
import { useRef } from 'react'
import { LoopRegion, ScoreDoc, docEndTick, ticksPerBar } from './score/types'

interface Props {
  doc: ScoreDoc
  pxPerTick: number
  scrollLeft: number
  loop: LoopRegion
  onLoopChange: (loop: LoopRegion) => void
  caretTick: number
  onCaretChange: (tick: number) => void
  playheadTick: number | null
}

const H = 22
const HANDLE = 7 // px edge zone

type Drag = { kind: 'new' | 'move' | 'l' | 'r'; startTick: number; origStart: number; origEnd: number } | null

export default function TimeRuler({ doc, pxPerTick, scrollLeft, loop, onLoopChange, onCaretChange, playheadTick }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>(null)
  const moved = useRef(false)
  const bar = ticksPerBar(doc.timeSig, doc.ppq)
  const totalTicks = Math.max(16 * bar, docEndTick(doc) + 4 * bar)
  const gridW = Math.ceil(totalTicks * pxPerTick)
  const snapBar = (tick: number) => Math.max(0, Math.round(tick / bar) * bar)

  const tickAt = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return (clientX - r.left + scrollLeft) / pxPerTick
  }

  const onDown = (e: React.PointerEvent) => {
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    moved.current = false
    const t = tickAt(e.clientX)
    if (loop.enabled) {
      const lx = loop.startTick
      const rx = loop.endTick
      if (Math.abs((t - lx) * pxPerTick) <= HANDLE) {
        drag.current = { kind: 'l', startTick: t, origStart: lx, origEnd: rx }
        return
      }
      if (Math.abs((t - rx) * pxPerTick) <= HANDLE) {
        drag.current = { kind: 'r', startTick: t, origStart: lx, origEnd: rx }
        return
      }
      if (t > lx && t < rx) {
        drag.current = { kind: 'move', startTick: t, origStart: lx, origEnd: rx }
        return
      }
    }
    drag.current = { kind: 'new', startTick: snapBar(t), origStart: 0, origEnd: 0 }
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    moved.current = true
    const t = tickAt(e.clientX)
    if (d.kind === 'new') {
      const a = Math.min(d.startTick, snapBar(t))
      const b = Math.max(d.startTick + bar, snapBar(t))
      onLoopChange({ startTick: a, endTick: Math.max(a + bar, b), enabled: true })
    } else if (d.kind === 'move') {
      const delta = snapBar(d.origStart + (t - d.startTick)) - d.origStart
      onLoopChange({ startTick: Math.max(0, d.origStart + delta), endTick: d.origEnd + delta, enabled: true })
    } else if (d.kind === 'l') {
      const s = Math.min(snapBar(t), d.origEnd - bar)
      onLoopChange({ startTick: Math.max(0, s), endTick: d.origEnd, enabled: true })
    } else if (d.kind === 'r') {
      const en = Math.max(snapBar(t), d.origStart + bar)
      onLoopChange({ startTick: d.origStart, endTick: en, enabled: true })
    }
  }

  const onUp = (e: React.PointerEvent) => {
    if (!moved.current) onCaretChange(snapBar(tickAt(e.clientX)))
    drag.current = null
  }

  return (
    <div
      ref={ref}
      className="relative border border-bg-3 rounded-md bg-bg-2 overflow-hidden select-none"
      style={{ height: H, touchAction: 'none', cursor: 'text' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      <div style={{ position: 'absolute', left: -scrollLeft, top: 0, width: gridW, height: '100%' }}>
        {/* bar numbers */}
        {Array.from({ length: Math.ceil(totalTicks / bar) + 1 }, (_, i) => (
          <span
            key={i}
            className="absolute top-0 text-[9px] text-text-3 tabular-nums"
            style={{ left: i * bar * pxPerTick + 2 }}
          >
            {i + 1}
          </span>
        ))}
        {/* loop brace */}
        {loop.enabled && (
          <div
            className="absolute top-0 bottom-0 border-x-2"
            style={{
              left: loop.startTick * pxPerTick,
              width: Math.max(2, (loop.endTick - loop.startTick) * pxPerTick),
              background: 'rgba(34,211,238,0.18)',
              borderColor: '#22d3ee',
            }}
          />
        )}
        {/* playhead tick */}
        {playheadTick != null && (
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: playheadTick * pxPerTick, width: 2, background: '#ef4444' }} />
        )}
      </div>
    </div>
  )
}
