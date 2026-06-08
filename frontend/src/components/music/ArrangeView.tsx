// Clip-timeline arrangement (Ableton Arrangement-view-lite). Each score is a
// clip you place on a lane at a bar position; clips repeat their source to fill
// their length. Combined playback/export flattens every clip into one ScoreDoc.
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, Play, Square, Repeat, Plus, Trash2, Download, Save } from 'lucide-react'
import { api } from '@/api/client'
import {
  ArrangementClip,
  ArrangementDoc,
  ScoreDoc,
  buildArrangementDoc,
  ceilToBar,
  docEndTick,
  secondsToTicks,
  ticksPerBar,
  uid,
} from './score/types'
import { ScorePlayer } from './score/transport'
import { docToMidi, downloadMidi } from './score/midiIo'

interface ScoreMeta {
  id: string
  name: string
  kind: 'midi' | 'tab'
}

interface Props {
  interestId: string
  onBack: () => void
}

const RULER_H = 18
const LANE_H = 46
const PPT = 24 / 480 // px per tick (coarser than the note editor)
const COLORS = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ec4899']

type Drag = { id: string; mode: 'move' | 'resize'; x0: number; lane0: number; startTick0: number; len0: number } | null

function ClipPreview({ src, widthPx, srcLenTick }: { src: ScoreDoc; widthPx: number; srcLenTick: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    const h = LANE_H - 20
    cv.width = Math.max(1, widthPx)
    cv.height = h
    ctx.clearRect(0, 0, cv.width, h)
    const notes = src.tracks.flatMap((t) => t.notes)
    if (!notes.length || srcLenTick <= 0) return
    const pitches = notes.map((n) => n.pitch)
    const lo = Math.min(...pitches)
    const hi = Math.max(...pitches)
    const span = Math.max(1, hi - lo)
    const repW = srcLenTick * PPT
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    for (let off = 0; off < cv.width; off += repW) {
      for (const n of notes) {
        const x = off + n.start * PPT
        if (x > cv.width) continue
        const y = h - ((n.pitch - lo) / span) * (h - 2) - 1
        ctx.fillRect(x, y, Math.max(1, n.dur * PPT), 1.5)
      }
    }
  }, [src, widthPx, srcLenTick])
  return <canvas ref={ref} className="block" />
}

export default function ArrangeView({ interestId, onBack }: Props) {
  const [arr, setArr] = useState<ArrangementDoc | null>(null)
  const [sources, setSources] = useState<Record<string, ScoreDoc>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [list, setList] = useState<ScoreMeta[]>([])
  const [pick, setPick] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playheadTick, setPlayheadTick] = useState<number | null>(null)
  const [loopOn, setLoopOn] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')
  const [dirty, setDirty] = useState(false)

  const player = useRef<ScorePlayer | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>(null)
  const moved = useRef(false)

  // load arrangement + every score's full doc
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [a, metas] = await Promise.all([
        api.get<ArrangementDoc>(`/plugins/music-project/arrangement/${interestId}`),
        api.get<ScoreMeta[]>(`/plugins/music-project/scores/${interestId}`),
      ])
      if (!alive) return
      setArr(a)
      setList(metas)
      const docs = await Promise.all(
        metas.map((m) => api.get<{ id: string; name: string; doc: ScoreDoc }>(`/plugins/music-project/score/${m.id}`)),
      )
      if (!alive) return
      const srcMap: Record<string, ScoreDoc> = {}
      const nameMap: Record<string, string> = {}
      for (const d of docs) {
        srcMap[d.id] = d.doc
        nameMap[d.id] = d.name
      }
      setSources(srcMap)
      setNames(nameMap)
    })()
    return () => {
      alive = false
    }
  }, [interestId])

  // transport
  useEffect(() => {
    const p = new ScorePlayer()
    p.setOnTick((sec) => setPlayheadTick(Math.max(0, secondsToTicks(sec, arr?.tempo ?? 120, arr?.ppq ?? 480))))
    p.setOnEnd(() => {
      setPlaying(false)
      setPlayheadTick(null)
    })
    player.current = p
    return () => p.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arr?.tempo, arr?.ppq])

  // autosave
  useEffect(() => {
    if (!dirty || !arr) return
    const t = setTimeout(() => {
      api.put(`/plugins/music-project/arrangement/${interestId}`, arr).then(() => setDirty(false)).catch(() => {})
    }, 700)
    return () => clearTimeout(t)
  }, [arr, dirty, interestId])

  const commit = useCallback((next: (a: ArrangementDoc) => ArrangementDoc) => {
    setArr((a) => (a ? next(a) : a))
    setDirty(true)
  }, [])

  if (!arr) return <p className="text-sm text-text-3">Loading arrangement…</p>

  const bar = ticksPerBar(arr.timeSig, arr.ppq)
  const arrEnd = Math.max(8 * bar, ...arr.clips.map((c) => c.startTick + c.lengthTick), 0)
  const totalTicks = arrEnd + 4 * bar
  const gridW = Math.ceil(totalTicks * PPT)
  const lanes = Math.max(arr.lanes, ...arr.clips.map((c) => c.lane + 1), 1)

  const srcLenOf = (scoreId: string) => {
    const s = sources[scoreId]
    return s ? ceilToBar(docEndTick(s), arr.timeSig, arr.ppq) : bar
  }

  const addClip = () => {
    if (!pick) return
    const lane = 0
    const onLane = arr.clips.filter((c) => c.lane === lane)
    const startTick = onLane.length ? Math.max(...onLane.map((c) => c.startTick + c.lengthTick)) : 0
    const len = srcLenOf(pick)
    const clip: ArrangementClip = { id: uid('c'), scoreId: pick, name: names[pick] ?? 'Clip', lane, startTick, lengthTick: len }
    commit((a) => ({ ...a, clips: [...a.clips, clip] }))
    setSelected(clip.id)
  }

  const removeClip = (id: string) => {
    commit((a) => ({ ...a, clips: a.clips.filter((c) => c.id !== id) }))
    if (selected === id) setSelected(null)
  }

  const play = async () => {
    if (playing) {
      player.current?.stop()
      setPlaying(false)
      setPlayheadTick(null)
      return
    }
    const built = buildArrangementDoc(arr, sources)
    setPlaying(true)
    await player.current?.play(built, 0, { loop: loopOn ? { startTick: 0, endTick: arrEnd } : undefined })
  }

  const exportMidi = () => downloadMidi(buildArrangementDoc(arr, sources), 'arrangement')
  const saveToProject = async () => {
    setSavedMsg('Saving…')
    try {
      const bytes = docToMidi(buildArrangementDoc(arr, sources))
      const fd = new FormData()
      fd.append('file', new File([bytes as unknown as BlobPart], 'arrangement.mid', { type: 'audio/midi' }))
      fd.append('interest_id', interestId)
      await api.upload('/media', fd)
      setSavedMsg('Saved ✓')
    } catch {
      setSavedMsg('Failed')
    }
    setTimeout(() => setSavedMsg(''), 2500)
  }

  // clip drag
  const onClipDown = (clip: ArrangementClip, mode: 'move' | 'resize', e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    moved.current = false
    setSelected(clip.id)
    drag.current = { id: clip.id, mode, x0: e.clientX, lane0: clip.lane, startTick0: clip.startTick, len0: clip.lengthTick }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    moved.current = true
    const dxTick = (e.clientX - d.x0) / PPT
    if (d.mode === 'move') {
      const start = Math.max(0, Math.round((d.startTick0 + dxTick) / bar) * bar)
      // lane from absolute pointer y
      const wrap = scrollRef.current
      let lane = d.lane0
      if (wrap) {
        const r = wrap.getBoundingClientRect()
        lane = Math.max(0, Math.floor((e.clientY - r.top - RULER_H + wrap.scrollTop) / LANE_H))
      }
      commit((a) => ({ ...a, clips: a.clips.map((c) => (c.id === d.id ? { ...c, startTick: start, lane } : c)) }))
    } else {
      const len = Math.max(bar, Math.round((d.len0 + dxTick) / bar) * bar)
      commit((a) => ({ ...a, clips: a.clips.map((c) => (c.id === d.id ? { ...c, lengthTick: len } : c)) }))
    }
  }
  const onPointerUp = () => {
    drag.current = null
  }

  return (
    <div className="space-y-3" onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <button className="btn-ghost flex items-center gap-1 py-1" onClick={onBack}>
          <ChevronLeft size={13} /> Scores
        </button>
        <span className="font-medium text-text-1">Arrangement</span>
        <button
          className="w-7 h-7 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center text-white"
          onClick={play}
        >
          {playing ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          className={`btn-ghost px-1.5 py-0.5 flex items-center gap-1 ${loopOn ? 'text-accent' : 'text-text-3'}`}
          onClick={() => setLoopOn((l) => !l)}
          title="Loop the whole arrangement"
        >
          <Repeat size={12} /> Loop
        </button>
        <label className="flex items-center gap-1 text-text-3">
          BPM
          <input
            type="number"
            min={20}
            max={300}
            value={arr.tempo}
            onChange={(e) => commit((a) => ({ ...a, tempo: Math.max(20, Math.min(300, Number(e.target.value))) }))}
            className="input w-14 py-0.5 h-auto"
          />
        </label>
        <div className="flex items-center gap-1 ml-auto">
          <select className="input py-0.5 h-auto max-w-[10rem]" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add score…</option>
            {list.map((m) => (
              <option key={m.id} value={m.id}>
                {names[m.id] ?? m.name}
              </option>
            ))}
          </select>
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={addClip} disabled={!pick}>
            <Plus size={12} /> Clip
          </button>
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={exportMidi}>
            <Download size={12} /> Export
          </button>
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={saveToProject}>
            <Save size={12} /> To project
          </button>
          <span className="text-text-3 w-14">{savedMsg || (dirty ? 'Saving…' : 'Saved')}</span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative border border-bg-3 rounded-lg bg-[#13131c] overflow-auto"
        style={{ height: Math.min(360, RULER_H + lanes * LANE_H + 4) }}
      >
        <div style={{ position: 'relative', width: gridW, height: RULER_H + lanes * LANE_H }}>
          {/* ruler */}
          <div className="sticky top-0 z-10" style={{ height: RULER_H, background: '#1a1a2e' }}>
            {Array.from({ length: Math.ceil(totalTicks / bar) + 1 }, (_, i) => (
              <span key={i} className="absolute top-0 text-[9px] text-text-3 tabular-nums" style={{ left: i * bar * PPT + 2 }}>
                {i + 1}
              </span>
            ))}
          </div>
          {/* lane backgrounds + bar lines */}
          {Array.from({ length: lanes }, (_, l) => (
            <div
              key={l}
              className="absolute left-0 border-b border-bg-3"
              style={{ top: RULER_H + l * LANE_H, height: LANE_H, width: gridW, background: l % 2 ? 'rgba(255,255,255,0.015)' : 'transparent' }}
            />
          ))}
          {Array.from({ length: Math.ceil(totalTicks / bar) + 1 }, (_, i) => (
            <div key={`b${i}`} className="absolute" style={{ left: i * bar * PPT, top: RULER_H, height: lanes * LANE_H, width: 1, background: '#262635' }} />
          ))}

          {/* clips */}
          {arr.clips.map((c) => {
            const left = c.startTick * PPT
            const w = Math.max(8, c.lengthTick * PPT)
            const color = COLORS[c.scoreId.charCodeAt(0) % COLORS.length]
            const src = sources[c.scoreId]
            return (
              <div
                key={c.id}
                onPointerDown={(e) => onClipDown(c, 'move', e)}
                className={`absolute rounded-md overflow-hidden cursor-grab ${selected === c.id ? 'ring-2 ring-white' : ''}`}
                style={{ left, top: RULER_H + c.lane * LANE_H + 2, width: w, height: LANE_H - 6, background: color }}
              >
                <div className="flex items-center justify-between px-1.5 pt-0.5">
                  <span className="text-[10px] text-white/90 truncate">{names[c.scoreId] ?? c.name}</span>
                  <button
                    className="text-white/70 hover:text-white"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => removeClip(c.id)}
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
                {src && <ClipPreview src={src} widthPx={w} srcLenTick={srcLenOf(c.scoreId)} />}
                {/* resize handle */}
                <div
                  onPointerDown={(e) => onClipDown(c, 'resize', e)}
                  className="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-white/10"
                />
              </div>
            )
          })}

          {/* playhead */}
          {playheadTick != null && (
            <div style={{ position: 'absolute', top: 0, left: playheadTick * PPT, width: 2, height: RULER_H + lanes * LANE_H, background: '#ef4444', pointerEvents: 'none' }} />
          )}
        </div>
      </div>

      {arr.clips.length === 0 && (
        <p className="text-sm text-text-3 italic">
          Pick a score above and add it as a clip. Drag clips to move them across lanes/bars, drag the
          right edge to repeat them, then Play to hear the whole arrangement.
        </p>
      )}
    </div>
  )
}
