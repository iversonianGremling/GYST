// Tablature editor (Guitar Pro / Songsterr style). A caret sits on a string at a
// time position; enter frets by typing digits (multi-digit, e.g. 1 then 2 = 12)
// or tapping the fret pad. Arrow keys move the caret (←/→ by the current note
// value, ↑/↓ between strings); Backspace clears. A duration selector sets the
// note value. Drag a note to move it (horizontal = time, vertical = string).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ScoreDoc,
  ScoreNote,
  docEndTick,
  fretToPitch,
  gridTicks,
  snapDown,
  ticksPerBar,
} from './score/types'
import { ScorePlayer } from './score/transport'
import type { ScoreEditorApi } from './score/useScoreEditor'

const KEYW = 34
const ROW_H = 30
const VIEW_H_MAX = 320
const FRETS = Array.from({ length: 13 }, (_, i) => i) // 0..12
const DURATIONS: { div: number; label: string }[] = [
  { div: 1, label: '1' },
  { div: 2, label: '½' },
  { div: 4, label: '♩' },
  { div: 8, label: '♪' },
  { div: 16, label: '16' },
  { div: 32, label: '32' },
]

const COL = {
  bg: '#13131c',
  line: '#262635',
  beat: '#33334a',
  bar: '#4a4a66',
  note: '#6366f1',
  noteSel: '#a5b4fc',
  caret: 'rgba(34,211,238,0.22)',
  caretBorder: '#22d3ee',
}

interface Props {
  doc: ScoreDoc
  editor: ScoreEditorApi
  trackIndex: number
  pxPerTick: number
  playheadTick: number | null
  onCaretChange: (tick: number) => void
  onScrollLeft?: (px: number) => void
  onZoomTime?: (factor: number) => void
}

interface Caret {
  tick: number
  str: number // tuning index, 0 = lowest string
}
type Drag = { id: string; x0: number; y0: number; start0: number; str0: number; fret: number; dStart: number; dStr: number; moved: boolean } | null

export default function TabEditor({
  doc,
  editor,
  trackIndex,
  pxPerTick,
  playheadTick,
  onCaretChange,
  onScrollLeft,
  onZoomTime,
}: Props) {
  const track = doc.tracks[trackIndex]
  const tuning = track.tuning ?? ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
  const nStrings = tuning.length
  const rowToString = (row: number) => nStrings - 1 - row
  const stringToRow = (s: number) => nStrings - 1 - s

  const gridRef = useRef<HTMLCanvasElement>(null)
  const labelRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [durDiv, setDurDiv] = useState(8)
  const [caret, setCaret] = useState<Caret>({ tick: 0, str: nStrings - 1 })
  const [selected, setSelected] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const lastTap = useRef<{ t: number; x: number; y: number }>({ t: 0, x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ lastDist: number } | null>(null)
  const digitBuf = useRef<{ val: string; at: number }>({ val: '', at: 0 })

  const durTicks = gridTicks(durDiv, doc.ppq)
  const contentH = nStrings * ROW_H
  const bar = ticksPerBar(doc.timeSig, doc.ppq)
  const totalTicks = Math.max(16 * bar, docEndTick(doc) + 4 * bar)
  const gridW = Math.ceil(totalTicks * pxPerTick)

  const moveCaret = useCallback(
    (next: Caret) => {
      setCaret(next)
      onCaretChange(next.tick)
    },
    [onCaretChange],
  )

  /* place/replace a fret at the caret */
  const placeFret = useCallback(
    (fret: number) => {
      const s = caret.str
      const pitch = fretToPitch(s, fret, tuning)
      const existing = track.notes.find((n) => n.string === s && n.start === caret.tick)
      if (existing) editor.updateNote(existing.id, { fret, pitch }, trackIndex)
      else editor.addNote({ pitch, start: caret.tick, dur: durTicks, vel: 100, string: s, fret }, trackIndex)
      void ScorePlayer.preview(track.instrument, pitch)
    },
    [caret, tuning, track.notes, track.instrument, editor, trackIndex, durTicks],
  )

  /* set the active note value; also resizes the selected note if any */
  const changeDur = useCallback(
    (div: number) => {
      setDurDiv(div)
      if (selected) {
        const n = track.notes.find((x) => x.id === selected)
        if (n) editor.updateNote(selected, { dur: gridTicks(div, doc.ppq) }, trackIndex)
      }
    },
    [selected, track.notes, editor, doc.ppq, trackIndex],
  )

  /* ── drawing ── */
  const draw = useCallback(() => {
    const cv = gridRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, gridW, contentH)
    ctx.fillStyle = COL.bg
    ctx.fillRect(0, 0, gridW, contentH)

    for (let row = 0; row < nStrings; row++) {
      const y = row * ROW_H + ROW_H / 2
      ctx.strokeStyle = COL.line
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(gridW, y)
      ctx.stroke()
    }
    const beat = bar / doc.timeSig[0]
    for (let tick = 0; tick <= totalTicks; tick += beat) {
      const x = Math.round(tick * pxPerTick) + 0.5
      ctx.strokeStyle = Math.round(tick) % Math.round(bar) === 0 ? COL.bar : COL.beat
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, contentH)
      ctx.stroke()
    }

    // caret cell
    {
      const row = stringToRow(caret.str)
      ctx.fillStyle = COL.caret
      ctx.fillRect(caret.tick * pxPerTick, row * ROW_H + 2, Math.max(10, durTicks * pxPerTick), ROW_H - 4)
      ctx.strokeStyle = COL.caretBorder
      ctx.lineWidth = 1
      ctx.strokeRect(caret.tick * pxPerTick + 0.5, row * ROW_H + 2.5, Math.max(10, durTicks * pxPerTick), ROW_H - 5)
    }

    for (const n of track.notes) {
      if (n.string == null) continue
      const start = drag && drag.id === n.id && drag.moved ? Math.max(0, n.start + drag.dStart) : n.start
      const s = drag && drag.id === n.id && drag.moved ? clampStr(n.string + drag.dStr) : n.string
      const row = stringToRow(s)
      const x = start * pxPerTick
      const w = Math.max(ROW_H - 6, n.dur * pxPerTick)
      const y = row * ROW_H + 3
      ctx.fillStyle = n.id === selected ? COL.noteSel : COL.note
      roundRect(ctx, x, y, w, ROW_H - 6, 5)
      ctx.fill()
      ctx.fillStyle = '#0b0b13'
      ctx.font = `bold ${ROW_H - 12}px ui-sans-serif, system-ui`
      ctx.textBaseline = 'middle'
      ctx.fillText(String(n.fret ?? 0), x + 5, row * ROW_H + ROW_H / 2 + 1)
    }
  }, [gridW, contentH, nStrings, bar, totalTicks, pxPerTick, track.notes, selected, drag, doc.timeSig, caret, durTicks])

  const drawLabels = useCallback(() => {
    const cv = labelRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    ctx.clearRect(0, 0, KEYW, contentH)
    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, KEYW, contentH)
    ctx.fillStyle = '#b8b8cc'
    ctx.font = '11px ui-monospace, monospace'
    ctx.textBaseline = 'middle'
    for (let row = 0; row < nStrings; row++) {
      ctx.fillText(tuning[rowToString(row)].replace(/\d/, ''), 9, row * ROW_H + ROW_H / 2)
    }
    ctx.strokeStyle = COL.line
    ctx.beginPath()
    ctx.moveTo(KEYW - 0.5, 0)
    ctx.lineTo(KEYW - 0.5, contentH)
    ctx.stroke()
  }, [contentH, nStrings, tuning])

  useEffect(() => {
    draw()
  }, [draw])
  useEffect(() => {
    drawLabels()
  }, [drawLabels])

  function clampStr(s: number) {
    return Math.max(0, Math.min(nStrings - 1, s))
  }

  const syncScroll = () => {
    const s = scrollRef.current
    const l = labelRef.current
    if (s && l) l.style.transform = `translateY(${-s.scrollTop}px)`
    if (s) onScrollLeft?.(s.scrollLeft)
  }

  /* ── keyboard ── */
  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
    const onKey = (e: KeyboardEvent) => {
      if (isField(e.target) || e.metaKey || e.ctrlKey) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        const now = Date.now()
        const buf = now - digitBuf.current.at < 800 ? digitBuf.current.val + e.key : e.key
        let val = parseInt(buf, 10)
        if (val > 24) val = parseInt(e.key, 10)
        digitBuf.current = { val: String(val), at: now }
        placeFret(val)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        moveCaret({ ...caret, tick: caret.tick + durTicks })
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        moveCaret({ ...caret, tick: Math.max(0, caret.tick - durTicks) })
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveCaret({ ...caret, str: clampStr(caret.str + 1) })
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveCaret({ ...caret, str: clampStr(caret.str - 1) })
      } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        // change the note value: +/= longer, -/_ shorter
        e.preventDefault()
        const idx = DURATIONS.findIndex((d) => d.div === durDiv)
        const longer = e.key === '+' || e.key === '='
        const ni = longer ? Math.max(0, idx - 1) : Math.min(DURATIONS.length - 1, idx + 1)
        changeDur(DURATIONS[ni].div)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        const ex = track.notes.find((n) => n.string === caret.str && n.start === caret.tick)
        if (ex) {
          e.preventDefault()
          editor.removeNotes([ex.id], trackIndex)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [caret, durTicks, durDiv, placeFret, moveCaret, changeDur, track.notes, editor, trackIndex])

  /* ── pointer ── */
  const xy = (e: React.PointerEvent) => {
    const r = gridRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const hit = (x: number, y: number): ScoreNote | null => {
    const s = rowToString(Math.floor(y / ROW_H))
    for (let i = track.notes.length - 1; i >= 0; i--) {
      const n = track.notes[i]
      if (n.string !== s) continue
      const x0 = n.start * pxPerTick
      const x1 = x0 + Math.max(ROW_H - 6, n.dur * pxPerTick)
      if (x >= x0 && x <= x1) return n
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      setDrag(null)
      const [a, b] = [...pointers.current.values()]
      pinch.current = { lastDist: Math.hypot(a.x - b.x, a.y - b.y) }
      return
    }
    if (pointers.current.size > 2) return
    const { x, y } = xy(e)
    gridRef.current?.setPointerCapture(e.pointerId)
    const now = Date.now()
    const lt = lastTap.current
    const isDouble = now - lt.t < 300 && Math.abs(x - lt.x) < 16 && Math.abs(y - lt.y) < 16
    lastTap.current = { t: now, x, y }

    const note = hit(x, y)
    if (isDouble) {
      if (note) editor.removeNotes([note.id], trackIndex)
      return
    }
    if (note && note.string != null) {
      moveCaret({ tick: note.start, str: note.string })
      setSelected(note.id)
      setDrag({ id: note.id, x0: x, y0: y, start0: note.start, str0: note.string, fret: note.fret ?? 0, dStart: 0, dStr: 0, moved: false })
    } else {
      const s = rowToString(Math.floor(y / ROW_H))
      moveCaret({ tick: snapDown(x / pxPerTick, durTicks), str: clampStr(s) })
      setSelected(null)
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
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
    const { x, y } = xy(e)
    const dx = x - drag.x0
    const dy = y - drag.y0
    if (!drag.moved && Math.abs(dx) < 6 && Math.abs(dy) < 6) return
    const newStart = Math.max(0, snapDown(drag.start0 + dx / pxPerTick, durTicks))
    const newStr = clampStr(drag.str0 - Math.round(dy / ROW_H))
    setDrag({ ...drag, moved: true, dStart: newStart - drag.start0, dStr: newStr - drag.str0 })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (drag && drag.moved) {
      const start = Math.max(0, drag.start0 + drag.dStart)
      const str = clampStr(drag.str0 + drag.dStr)
      editor.updateNote(drag.id, { start, string: str, pitch: fretToPitch(str, drag.fret, tuning) }, trackIndex)
      moveCaret({ tick: start, str })
    }
    setDrag(null)
  }

  const onLabelDown = (e: React.PointerEvent) => {
    const r = labelRef.current!.getBoundingClientRect()
    const y = e.clientY - r.top + (scrollRef.current?.scrollTop ?? 0)
    const s = rowToString(Math.floor(y / ROW_H))
    void ScorePlayer.preview(track.instrument, fretToPitch(clampStr(s), 0, tuning))
  }

  const tapFret = (f: number) => {
    placeFret(f)
    moveCaret({ ...caret, tick: caret.tick + durTicks })
  }

  const viewH = Math.min(VIEW_H_MAX, contentH + 2)

  return (
    <div className="space-y-2">
      {/* duration selector */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text-3">Note</span>
        <div className="flex gap-0.5">
          {DURATIONS.map((d) => (
            <button
              key={d.div}
              onClick={() => changeDur(d.div)}
              className={`w-8 h-7 rounded-md border text-sm ${
                durDiv === d.div ? 'bg-accent text-white border-accent' : 'border-bg-3 text-text-2 hover:border-accent/50'
              }`}
              title={`1/${d.div} note`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex border border-bg-3 rounded-lg overflow-hidden bg-[#13131c]">
        <div style={{ width: KEYW, height: viewH, overflow: 'hidden' }} className="shrink-0">
          <canvas ref={labelRef} width={KEYW} height={contentH} onPointerDown={onLabelDown} style={{ display: 'block', cursor: 'pointer' }} />
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
            style={{ display: 'block', touchAction: 'none', cursor: 'pointer' }}
          />
          {playheadTick != null && (
            <div style={{ position: 'absolute', top: 0, left: playheadTick * pxPerTick, width: 2, height: contentH, background: '#ef4444', pointerEvents: 'none' }} />
          )}
        </div>
      </div>

      {/* fret pad */}
      <div className="flex flex-wrap gap-1">
        {FRETS.map((f) => (
          <button
            key={f}
            onClick={() => tapFret(f)}
            className="w-8 h-8 rounded-md text-sm tabular-nums border border-bg-3 text-text-2 hover:border-accent hover:text-accent"
          >
            {f}
          </button>
        ))}
      </div>
      <p className="text-xs text-text-3">
        Tap a cell to place the caret, then type a fret (e.g. <kbd>1</kbd><kbd>2</kbd> = 12) or tap a
        pad button · arrows move the caret · <kbd>−</kbd>/<kbd>=</kbd> change the note value · drag a
        note to move it · double-tap or <kbd>⌫</kbd> to clear.
      </p>
    </div>
  )
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}
