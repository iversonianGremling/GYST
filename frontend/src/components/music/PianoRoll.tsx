// Canvas piano-roll (Ableton-style). Two synced canvases: a pinned key column
// and the scrollable note grid. Notes are drawn from the doc; playhead/caret are
// DOM overlays so playback never redraws the grid.
//
// Existing notes behave the same in both modes: click = select & drag to move
// (all selected together), drag the right edge = resize, double-click = delete.
// A single click never deletes. The modes differ only on empty space: Draw mode
// (B) paints a new note; Edit mode marquee-selects (and double-click empty space
// creates a note). Notes are coloured by velocity.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ScoreDoc,
  ScoreNote,
  Track,
  docEndTick,
  isBlackKey,
  midiToName,
  quantize,
  snapDown,
  ticksPerBar,
} from './score/types'
import { ScorePlayer } from './score/transport'
import type { ScoreEditorApi } from './score/useScoreEditor'

const LOW = 24 // C1
const HIGH = 96 // C7
const ROWS = HIGH - LOW + 1
const KEYW = 50
const VIEW_H = 360 // default; overridable via the viewH prop (fullscreen fills the screen)
const EDGE = 6 // px hit zone for resize

const COL = {
  bg: '#13131c',
  // Lane backgrounds mirror the piano keys: white-key rows lighter, black-key
  // rows darker — so it's obvious which note each row is.
  rowWhite: '#1b1b26',
  rowBlack: '#101017',
  line: '#262635',
  octave: '#3b3b57', // stronger separator at each C
  beat: '#33334a',
  bar: '#4a4a66',
  noteBorder: '#1e1b4b',
  noteSel: '#c7d2fe',
}

interface Props {
  doc: ScoreDoc
  trackIndex: number
  editor: ScoreEditorApi
  pxPerTick: number
  rowH: number
  snap: number
  drawMode: boolean
  playheadTick: number | null
  caretTick: number
  onCaretChange: (tick: number) => void
  selection: Set<string>
  onSelectionChange: (s: Set<string>) => void
  onScrollLeft?: (px: number) => void
  ghostTracks?: Track[]
  viewH?: number
  eraseMode?: boolean
  onZoomTime?: (factor: number) => void
}

type Drag =
  | { mode: 'new'; note: ScoreNote }
  | { mode: 'move'; ids: Set<string>; anchorStart: number; anchorPitch: number; grabOffset: number; dStart: number; dPitch: number }
  | { mode: 'resize'; ids: Set<string>; anchorStart: number; anchorDur: number; dDur: number }
  | { mode: 'marquee'; add: boolean; x0: number; y0: number; x1: number; y1: number }
  | null

/** Note fill colour scaled by velocity (dim → bright indigo). */
function velColor(vel: number): string {
  const t = Math.max(0, Math.min(1, vel / 127))
  const a = [74, 78, 134]
  const b = [129, 140, 248]
  const c = a.map((x, i) => Math.round(x + (b[i] - x) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function PianoRoll({
  doc,
  trackIndex,
  editor,
  pxPerTick,
  rowH,
  snap,
  drawMode,
  playheadTick,
  caretTick,
  onCaretChange,
  selection,
  onSelectionChange,
  onScrollLeft,
  ghostTracks,
  viewH = VIEW_H,
  eraseMode = false,
  onZoomTime,
}: Props) {
  const gridRef = useRef<HTMLCanvasElement>(null)
  const keysRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag>(null)
  // Active touch/pen pointers for two-finger pinch-zoom.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ lastDist: number } | null>(null)

  const track = doc.tracks[trackIndex]
  const contentH = ROWS * rowH
  const barTicks = ticksPerBar(doc.timeSig, doc.ppq)
  const endTick = docEndTick(doc)
  const totalTicks = Math.max(16 * barTicks, endTick + 4 * barTicks)
  const gridW = Math.ceil(totalTicks * pxPerTick)

  const yForPitch = (p: number) => (HIGH - p) * rowH
  const pitchForY = (y: number) => HIGH - Math.floor(y / rowH)
  const clampPitch = (p: number) => Math.max(LOW, Math.min(HIGH, p))

  /* ── draw the static note grid ── */
  const drawGrid = useCallback(() => {
    const cv = gridRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, gridW, contentH)

    for (let p = HIGH; p >= LOW; p--) {
      const y = yForPitch(p)
      // Fill every lane to match its key colour (lighter = white key).
      ctx.fillStyle = isBlackKey(p) ? COL.rowBlack : COL.rowWhite
      ctx.fillRect(0, y, gridW, rowH)
      // Brighter separator under each C marks the octave boundary.
      ctx.strokeStyle = p % 12 === 0 ? COL.octave : COL.line
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, y + 0.5)
      ctx.lineTo(gridW, y + 0.5)
      ctx.stroke()
    }

    const beatTicks = barTicks / doc.timeSig[0]
    for (let tick = 0; tick <= totalTicks; tick += beatTicks) {
      const x = Math.round(tick * pxPerTick) + 0.5
      const isBar = Math.round(tick) % Math.round(barTicks) === 0
      ctx.strokeStyle = isBar ? COL.bar : COL.beat
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, contentH)
      ctx.stroke()
    }

    if (ghostTracks && ghostTracks.length) {
      ctx.globalAlpha = 0.22
      ctx.fillStyle = '#94a3b8'
      for (const gt of ghostTracks) {
        for (const n of gt.notes) {
          ctx.fillRect(n.start * pxPerTick, yForPitch(n.pitch) + 0.5, Math.max(2, n.dur * pxPerTick), rowH - 1.5)
        }
      }
      ctx.globalAlpha = 1
    }

    for (const n of track.notes) {
      const shown = shownNote(n, drag, selection, snap)
      const sel = selection.has(n.id)
      drawNote(ctx, shown, sel, pxPerTick, rowH, yForPitch)
    }
    if (drag && drag.mode === 'new') drawNote(ctx, drag.note, true, pxPerTick, rowH, yForPitch)

    if (drag && drag.mode === 'marquee') {
      ctx.strokeStyle = COL.noteSel
      ctx.fillStyle = 'rgba(165,180,252,0.12)'
      const x = Math.min(drag.x0, drag.x1)
      const y = Math.min(drag.y0, drag.y1)
      ctx.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
      ctx.strokeRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0))
    }
  }, [gridW, contentH, barTicks, totalTicks, pxPerTick, rowH, track.notes, selection, drag, doc.timeSig, ghostTracks, snap])

  const drawKeys = useCallback(() => {
    const cv = keysRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, KEYW, contentH)
    for (let p = HIGH; p >= LOW; p--) {
      const y = yForPitch(p)
      ctx.fillStyle = isBlackKey(p) ? '#1a1a2e' : '#e9e9f3'
      ctx.fillRect(0, y, KEYW, rowH - 0.5)
      if (p % 12 === 0) {
        ctx.fillStyle = '#888'
        ctx.font = '9px ui-sans-serif, system-ui'
        ctx.fillText(midiToName(p), 4, y + rowH - 3)
      }
    }
    ctx.strokeStyle = COL.line
    ctx.beginPath()
    ctx.moveTo(KEYW - 0.5, 0)
    ctx.lineTo(KEYW - 0.5, contentH)
    ctx.stroke()
  }, [contentH, rowH])

  useEffect(() => {
    drawGrid()
  }, [drawGrid])
  useEffect(() => {
    drawKeys()
  }, [drawKeys])

  const syncScroll = useCallback(() => {
    const s = scrollRef.current
    const k = keysRef.current
    if (s && k) k.style.transform = `translateY(${-s.scrollTop}px)`
    if (s) onScrollLeft?.(s.scrollLeft)
  }, [onScrollLeft])

  useEffect(() => {
    if (playheadTick == null) return
    const s = scrollRef.current
    if (!s) return
    const x = playheadTick * pxPerTick
    if (x < s.scrollLeft + 40 || x > s.scrollLeft + s.clientWidth - 40) {
      s.scrollLeft = Math.max(0, x - s.clientWidth * 0.3)
    }
  }, [playheadTick, pxPerTick])

  /* ── hit testing ── */
  const eventXY = (e: { clientX: number; clientY: number }) => {
    const r = gridRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const hitNote = (x: number, y: number): { note: ScoreNote; edge: boolean } | null => {
    for (let i = track.notes.length - 1; i >= 0; i--) {
      const n = track.notes[i]
      const ny = yForPitch(n.pitch)
      const x0 = n.start * pxPerTick
      const x1 = (n.start + n.dur) * pxPerTick
      if (y >= ny && y < ny + rowH && x >= x0 - 1 && x <= x1 + 1) return { note: n, edge: x >= x1 - EDGE }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Second finger → start a pinch-zoom; abandon any in-progress note edit.
    if (pointers.current.size === 2) {
      setDrag(null)
      const [a, b] = [...pointers.current.values()]
      pinch.current = { lastDist: Math.hypot(a.x - b.x, a.y - b.y) }
      return
    }
    if (pointers.current.size > 2 || e.button !== 0) return
    const { x, y } = eventXY(e)
    gridRef.current?.setPointerCapture(e.pointerId)
    const hit = hitNote(x, y)

    // Eraser tool: a single tap on a note deletes it (touch-friendly).
    if (eraseMode) {
      if (hit) {
        editor.removeNotes([hit.note.id], trackIndex)
        if (selection.has(hit.note.id)) {
          const n = new Set(selection)
          n.delete(hit.note.id)
          onSelectionChange(n)
        }
      }
      return
    }

    const tick = x / pxPerTick

    // Clicking an existing note always selects + drags it (never deletes), in
    // both draw and edit modes. Delete is a double-click.
    if (hit && hit.edge) {
      const ids = selection.has(hit.note.id) ? new Set(selection) : new Set([hit.note.id])
      onSelectionChange(ids)
      setDrag({ mode: 'resize', ids, anchorStart: hit.note.start, anchorDur: hit.note.dur, dDur: 0 })
      return
    }
    if (hit) {
      let ids: Set<string>
      if (e.shiftKey) {
        ids = new Set(selection)
        ids.add(hit.note.id)
      } else {
        ids = selection.has(hit.note.id) ? new Set(selection) : new Set([hit.note.id])
      }
      onSelectionChange(ids)
      setDrag({
        mode: 'move',
        ids,
        anchorStart: hit.note.start,
        anchorPitch: hit.note.pitch,
        grabOffset: tick - hit.note.start,
        dStart: 0,
        dPitch: 0,
      })
      return
    }

    // Empty space: draw mode paints a new note, edit mode starts a marquee.
    if (drawMode) {
      const pitch = pitchForY(y)
      const start = snapDown(tick, snap)
      onCaretChange(start + snap)
      void ScorePlayer.preview(track.instrument, pitch)
      setDrag({ mode: 'new', note: { id: '_draft', pitch, start, dur: snap, vel: 100 } })
    } else {
      if (!e.shiftKey) onSelectionChange(new Set())
      setDrag({ mode: 'marquee', add: e.shiftKey, x0: x, y0: y, x1: x, y1: y })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    // Pinch-zoom the timeline: feed the frame-to-frame distance ratio to the
    // host's zoom (continuous because each step multiplies pxPerTick).
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const f = d / pinch.current.lastDist
      if (Number.isFinite(f) && f > 0 && Math.abs(f - 1) > 0.012) {
        onZoomTime?.(f)
        pinch.current.lastDist = d
      }
      return
    }
    if (!drag) return
    const { x, y } = eventXY(e)
    const tick = x / pxPerTick
    if (drag.mode === 'new') {
      setDrag({ ...drag, note: { ...drag.note, dur: Math.max(snap, quantize(tick, snap) - drag.note.start) } })
    } else if (drag.mode === 'move') {
      const newAnchor = Math.max(0, snapDown(tick - drag.grabOffset, snap))
      const dStart = newAnchor - drag.anchorStart
      const dPitch = clampPitch(pitchForY(y)) - drag.anchorPitch
      if (dPitch !== drag.dPitch) void ScorePlayer.preview(track.instrument, drag.anchorPitch + dPitch)
      setDrag({ ...drag, dStart, dPitch })
    } else if (drag.mode === 'resize') {
      const newDur = Math.max(snap, quantize(tick, snap) - drag.anchorStart)
      setDrag({ ...drag, dDur: newDur - drag.anchorDur })
    } else if (drag.mode === 'marquee') {
      setDrag({ ...drag, x1: x, y1: y })
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (!drag) return
    if (drag.mode === 'new') {
      editor.addNote({ pitch: drag.note.pitch, start: drag.note.start, dur: drag.note.dur, vel: drag.note.vel }, trackIndex)
    } else if (drag.mode === 'move') {
      const { ids, dStart, dPitch } = drag
      if (dStart || dPitch) {
        editor.commit((d) => mapTrack(d, trackIndex, (t) => ({
          ...t,
          notes: t.notes.map((n) =>
            ids.has(n.id) ? { ...n, start: Math.max(0, n.start + dStart), pitch: clampPitch(n.pitch + dPitch) } : n,
          ),
        })))
      }
    } else if (drag.mode === 'resize') {
      const { ids, dDur } = drag
      if (dDur) {
        editor.commit((d) => mapTrack(d, trackIndex, (t) => ({
          ...t,
          notes: t.notes.map((n) => (ids.has(n.id) ? { ...n, dur: Math.max(snap, n.dur + dDur) } : n)),
        })))
      }
    } else if (drag.mode === 'marquee') {
      const x = Math.min(drag.x0, drag.x1)
      const y = Math.min(drag.y0, drag.y1)
      const xe = Math.max(drag.x0, drag.x1)
      const ye = Math.max(drag.y0, drag.y1)
      const picked = drag.add ? new Set(selection) : new Set<string>()
      for (const n of track.notes) {
        const ny = yForPitch(n.pitch)
        const nx0 = n.start * pxPerTick
        const nx1 = (n.start + n.dur) * pxPerTick
        if (nx1 >= x && nx0 <= xe && ny + rowH >= y && ny <= ye) picked.add(n.id)
      }
      onSelectionChange(picked)
    }
    setDrag(null)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = eventXY(e)
    const hit = hitNote(x, y)
    if (hit) {
      // double-click deletes — in both modes
      editor.removeNotes([hit.note.id], trackIndex)
      if (selection.has(hit.note.id)) {
        const next = new Set(selection)
        next.delete(hit.note.id)
        onSelectionChange(next)
      }
    } else if (!drawMode) {
      const pitch = pitchForY(y)
      const start = snapDown(x / pxPerTick, snap)
      void ScorePlayer.preview(track.instrument, pitch)
      editor.addNote({ pitch, start, dur: snap, vel: 100 }, trackIndex)
    }
  }

  const onKeysPointerDown = (e: React.PointerEvent) => {
    const r = keysRef.current!.getBoundingClientRect()
    const y = e.clientY - r.top + (scrollRef.current?.scrollTop ?? 0)
    void ScorePlayer.preview(track.instrument, pitchForY(y))
  }

  return (
    <div className="flex border border-bg-3 rounded-lg overflow-hidden bg-[#13131c]">
      <div style={{ width: KEYW, height: viewH, overflow: 'hidden' }} className="shrink-0">
        <canvas ref={keysRef} width={KEYW} height={contentH} onPointerDown={onKeysPointerDown} style={{ display: 'block', cursor: 'pointer' }} />
      </div>
      <div ref={scrollRef} onScroll={syncScroll} style={{ height: viewH, overflow: 'auto', position: 'relative', flex: 1 }}>
        <canvas
          ref={gridRef}
          width={gridW}
          height={contentH}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
          style={{ display: 'block', cursor: eraseMode ? 'pointer' : drawMode ? 'cell' : 'default', touchAction: 'none' }}
        />
        <div style={{ position: 'absolute', top: 0, left: caretTick * pxPerTick, width: 2, height: contentH, background: '#22d3ee', opacity: 0.7, pointerEvents: 'none' }} />
        {playheadTick != null && (
          <div style={{ position: 'absolute', top: 0, left: playheadTick * pxPerTick, width: 2, height: contentH, background: '#ef4444', pointerEvents: 'none' }} />
        )}
      </div>
    </div>
  )
}

function mapTrack(doc: ScoreDoc, ti: number, fn: (t: Track) => Track): ScoreDoc {
  return { ...doc, tracks: doc.tracks.map((t, i) => (i === ti ? fn(t) : t)) }
}

/** Apply a live drag's geometry to a note for rendering. */
function shownNote(n: ScoreNote, drag: Drag, selection: Set<string>, snap: number): ScoreNote {
  if (!drag || !selection.has(n.id)) return n
  if (drag.mode === 'move') {
    return { ...n, start: Math.max(0, n.start + drag.dStart), pitch: n.pitch + drag.dPitch }
  }
  if (drag.mode === 'resize') {
    return { ...n, dur: Math.max(snap, n.dur + drag.dDur) }
  }
  return n
}

function drawNote(
  ctx: CanvasRenderingContext2D,
  n: ScoreNote,
  selected: boolean,
  pxPerTick: number,
  rowH: number,
  yForPitch: (p: number) => number,
) {
  const x = n.start * pxPerTick
  const w = Math.max(2, n.dur * pxPerTick)
  const y = yForPitch(n.pitch)
  const h = rowH - 1.5
  ctx.fillStyle = selected ? COL.noteSel : velColor(n.vel)
  ctx.fillRect(x, y + 0.5, w, h)
  ctx.strokeStyle = selected ? '#ffffff' : COL.noteBorder
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 1, w - 1, h - 1)
  if (n.lyric && w > 14) {
    ctx.fillStyle = '#0b0b13'
    ctx.font = `${Math.min(rowH - 4, 10)}px ui-sans-serif, system-ui`
    ctx.fillText(n.lyric.slice(0, 6), x + 2, y + rowH - 3)
  }
}
