// Phase 4 UI — sing/hum a melody and drop the detected notes onto the track.
// Live: notes appear as you sing. Record: capture a clip, analyse, preview,
// then commit. Monophonic. Notes are laid from the caret using their real
// timing, quantised to the snap grid.
import { useCallback, useRef, useState } from 'react'
import { Mic, Square, Check, Trash2, X } from 'lucide-react'
import {
  ScoreDoc,
  ScoreNote,
  midiToName,
  quantize,
  secondsToTicks,
} from './score/types'
import type { ScoreEditorApi } from './score/useScoreEditor'
import { LivePitchTracker, analyzeBuffer, type DetectedNote } from './score/usePitchDetect'

interface Props {
  doc: ScoreDoc
  editor: ScoreEditorApi
  trackIndex: number
  snap: number
  caretTick: number
  onClose: () => void
}

type Mode = 'live' | 'record'

export default function SingCapture({ doc, editor, trackIndex, snap, caretTick, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('live')
  const [active, setActive] = useState(false)
  const [current, setCurrent] = useState<{ midi: number | null; clarity: number }>({ midi: null, clarity: 0 })
  const [count, setCount] = useState(0)
  const [preview, setPreview] = useState<DetectedNote[] | null>(null)
  const [busy, setBusy] = useState(false)

  const tracker = useRef<LivePitchTracker | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const baseTick = useRef(0)

  const toNotes = useCallback(
    (detected: DetectedNote[]): Omit<ScoreNote, 'id'>[] =>
      detected.map((d) => {
        const start = baseTick.current + quantize(secondsToTicks(d.startSec, doc.tempo, doc.ppq), snap)
        const dur = Math.max(snap, quantize(secondsToTicks(d.durSec, doc.tempo, doc.ppq), snap))
        return { pitch: d.midi, start, dur, vel: 100 }
      }),
    [doc.tempo, doc.ppq, snap],
  )

  const appendNotes = useCallback(
    (notes: Omit<ScoreNote, 'id'>[]) => {
      if (notes.length === 0) return
      editor.commit((d) => ({
        ...d,
        tracks: d.tracks.map((t, ti) =>
          ti !== trackIndex
            ? t
            : {
                ...t,
                notes: [...t.notes, ...notes.map((n, i) => ({ ...n, id: `sing${Date.now().toString(36)}${i}` }))],
              },
        ),
      }))
    },
    [editor, trackIndex],
  )

  /* ── live ── */
  const startLive = async () => {
    baseTick.current = caretTick
    setCount(0)
    const tk = new LivePitchTracker(
      (n) => {
        appendNotes(toNotes([n]))
        setCount((c) => c + 1)
      },
      (midi, clarity) => setCurrent({ midi, clarity }),
    )
    tracker.current = tk
    try {
      await tk.start()
      setActive(true)
    } catch {
      setActive(false)
    }
  }
  const stopLive = () => {
    tracker.current?.stop()
    tracker.current = null
    setActive(false)
    setCurrent({ midi: null, clarity: 0 })
  }

  /* ── record ── */
  const startRecord = async () => {
    baseTick.current = caretTick
    setPreview(null)
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    chunks.current = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data)
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      setBusy(true)
      try {
        const blob = new Blob(chunks.current)
        const arr = await blob.arrayBuffer()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new Ctx()
        const audio = await ctx.decodeAudioData(arr)
        void ctx.close()
        setPreview(analyzeBuffer(audio))
      } finally {
        setBusy(false)
      }
    }
    recorder.current = rec
    rec.start()
    setActive(true)
  }
  const stopRecord = () => {
    recorder.current?.stop()
    recorder.current = null
    setActive(false)
  }

  const commitPreview = () => {
    if (preview) appendNotes(toNotes(preview))
    setPreview(null)
  }

  const clarityPct = Math.round(current.clarity * 100)

  return (
    <div className="border border-bg-3 rounded-lg p-3 space-y-3 bg-bg-2">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text-2 font-medium flex items-center gap-1">
          <Mic size={13} /> Sing to notes
        </span>
        <div className="flex gap-0.5 ml-2">
          {(['live', 'record'] as Mode[]).map((m) => (
            <button
              key={m}
              disabled={active}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded capitalize ${
                mode === m ? 'bg-accent text-white' : 'text-text-3 hover:text-text-1'
              } disabled:opacity-40`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="text-text-3 ml-auto">notes go at the caret · monophonic</span>
        <button className="text-text-3 hover:text-text-1" onClick={onClose} title="Close">
          <X size={14} />
        </button>
      </div>

      {mode === 'live' ? (
        <div className="flex items-center gap-4">
          {!active ? (
            <button className="btn-primary text-xs flex items-center gap-1.5" onClick={startLive}>
              <Mic size={13} /> Start singing
            </button>
          ) : (
            <button className="btn-ghost text-xs flex items-center gap-1.5 text-danger" onClick={stopLive}>
              <Square size={13} /> Stop
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="text-2xl font-mono tabular-nums w-16 text-text-1">
              {current.midi != null ? midiToName(current.midi) : '—'}
            </div>
            <div className="w-24 h-1.5 bg-bg-3 rounded-full overflow-hidden">
              <div className="h-full bg-accent" style={{ width: `${clarityPct}%` }} />
            </div>
          </div>
          <span className="text-xs text-text-3">{count} notes added</span>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            {!active ? (
              <button className="btn-primary text-xs flex items-center gap-1.5" onClick={startRecord} disabled={busy}>
                <Mic size={13} /> Record
              </button>
            ) : (
              <button className="btn-ghost text-xs flex items-center gap-1.5 text-danger" onClick={stopRecord}>
                <Square size={13} /> Stop
              </button>
            )}
            {busy && <span className="text-xs text-text-3 animate-pulse">Analysing…</span>}
            {active && <span className="text-xs text-danger animate-pulse">● recording…</span>}
          </div>

          {preview && (
            <div className="space-y-2">
              <div className="text-xs text-text-2">
                Detected {preview.length} notes:{' '}
                <span className="text-text-3 font-mono">
                  {preview.slice(0, 24).map((n) => midiToName(n.midi)).join(' ')}
                  {preview.length > 24 ? ' …' : ''}
                </span>
              </div>
              <div className="flex gap-2">
                <button className="btn-primary text-xs flex items-center gap-1.5" onClick={commitPreview}>
                  <Check size={13} /> Add {preview.length} notes
                </button>
                <button
                  className="btn-ghost text-xs flex items-center gap-1.5"
                  onClick={() => setPreview(null)}
                >
                  <Trash2 size={13} /> Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
