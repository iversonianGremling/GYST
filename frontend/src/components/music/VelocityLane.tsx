// Velocity editor (Ableton-style): one draggable marker per note under the
// piano roll, aligned to the same time axis. Drag a marker up/down to set the
// note's velocity (1–127). Markers are coloured to match the note.
import { useRef } from 'react'
import { ScoreDoc, docEndTick, ticksPerBar } from './score/types'
import type { ScoreEditorApi } from './score/useScoreEditor'

interface Props {
  doc: ScoreDoc
  editor: ScoreEditorApi
  trackIndex: number
  pxPerTick: number
  scrollLeft: number
  selection: Set<string>
}

const LANE_H = 60

function velColor(vel: number): string {
  const t = Math.max(0, Math.min(1, vel / 127))
  const a = [74, 78, 134]
  const b = [129, 140, 248]
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function VelocityLane({ doc, editor, trackIndex, pxPerTick, scrollLeft, selection }: Props) {
  const track = doc.tracks[trackIndex]
  const dragId = useRef<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const bar = ticksPerBar(doc.timeSig, doc.ppq)
  const totalTicks = Math.max(16 * bar, docEndTick(doc) + 4 * bar)
  const gridW = Math.ceil(totalTicks * pxPerTick)

  const velFromY = (clientY: number): number => {
    const r = boxRef.current!.getBoundingClientRect()
    const frac = 1 - (clientY - r.top) / r.height
    return Math.max(1, Math.min(127, Math.round(frac * 127)))
  }

  const onDown = (id: string, e: React.PointerEvent) => {
    dragId.current = id
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    editor.updateNote(id, { vel: velFromY(e.clientY) }, trackIndex)
  }
  const onMove = (e: React.PointerEvent) => {
    if (!dragId.current) return
    editor.updateNote(dragId.current, { vel: velFromY(e.clientY) }, trackIndex)
  }
  const onUp = () => {
    dragId.current = null
  }

  return (
    <div className="space-y-1">
      <span className="text-xs text-text-3">Velocity</span>
      <div
        ref={boxRef}
        className="relative border border-bg-3 rounded-lg bg-bg-2 overflow-hidden"
        style={{ height: LANE_H, touchAction: 'none' }}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <div style={{ position: 'absolute', left: -scrollLeft, top: 0, width: gridW, height: '100%' }}>
          {track.notes.map((n) => {
            const x = n.start * pxPerTick
            const h = (n.vel / 127) * LANE_H
            const sel = selection.has(n.id)
            return (
              <div
                key={n.id}
                onPointerDown={(e) => onDown(n.id, e)}
                className="absolute bottom-0 cursor-ns-resize"
                style={{ left: x, width: 3, height: h, background: sel ? '#c7d2fe' : velColor(n.vel) }}
                title={`vel ${n.vel}`}
              >
                <div className="absolute -top-0.5 -left-0.5 w-1 h-1 rounded-full" style={{ background: sel ? '#fff' : '#a5b4fc' }} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
