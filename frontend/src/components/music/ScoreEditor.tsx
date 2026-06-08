// Host for one score: toolbar + transport + keyboard/MIDI input, wrapping the
// PianoRoll. Owns playback (ScorePlayer), the caret, selection and recording.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Tone from 'tone'
import {
  ChevronLeft,
  Play,
  Square,
  Circle,
  Undo2,
  Redo2,
  Download,
  Upload,
  ZoomIn,
  ZoomOut,
  Mic,
  Save,
  Plus,
  Volume2,
  VolumeX,
  Trash2,
  Pencil,
  Repeat,
  Copy,
  Magnet,
  Sliders,
  Eraser,
} from 'lucide-react'
import {
  LoopRegion,
  ScoreDoc,
  gridTicks,
  midiToName,
  quantize,
  secondsToTicks,
  ticksPerBar,
  uid,
} from './score/types'
import { api } from '@/api/client'
import { INSTRUMENTS, makeSynth, type VoiceInstrument } from './score/synth'
import { ScorePlayer } from './score/transport'
import { docToMidi, downloadMidi, midiToDoc } from './score/midiIo'
import { useScoreEditor } from './score/useScoreEditor'
import PianoRoll from './PianoRoll'
import TabEditor from './TabEditor'
import TimeRuler from './TimeRuler'
import VelocityLane from './VelocityLane'
import AudioAlignLane, { type AudioLaneHandle } from './AudioAlignLane'
import LyricLane from './LyricLane'
import SingCapture from './SingCapture'

const KEY_SEMITONE: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15,
}
const SNAP_DIVISIONS = [4, 8, 16, 32]
const ROW_HEIGHTS = [10, 12, 14, 18, 24]

interface Props {
  scoreId: string
  initialDoc: ScoreDoc
  name: string
  interestId: string
  onBack: () => void
  fullscreen?: boolean
}

export default function ScoreEditor({ scoreId, initialDoc, name, interestId, onBack, fullscreen = false }: Props) {
  const editor = useScoreEditor(scoreId, initialDoc)
  const { doc } = editor

  const [activeTrack, setActiveTrack] = useState(0)
  const ti = Math.min(activeTrack, doc.tracks.length - 1)
  const track = doc.tracks[ti]

  const [muted, setMuted] = useState<Set<string>>(new Set())
  const [solo, setSolo] = useState<string | null>(null)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const [playing, setPlaying] = useState(false)
  const [playheadTick, setPlayheadTick] = useState<number | null>(null)
  const [caretTick, setCaretTick] = useState(0)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [snapDiv, setSnapDiv] = useState(16)
  const [pxPerTick, setPxPerTick] = useState(40 / 480) // ~40px per quarter
  const [rowH, setRowH] = useState(14)
  const [drawMode, setDrawMode] = useState(true)
  const [eraseMode, setEraseMode] = useState(false)
  const [loop, setLoop] = useState<LoopRegion>(
    initialDoc.loop ?? { startTick: 0, endTick: 0, enabled: false },
  )
  const [octave, setOctave] = useState(4)
  const [recording, setRecording] = useState(false)
  const [midiOn, setMidiOn] = useState(false)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [showSing, setShowSing] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [winH, setWinH] = useState(typeof window !== 'undefined' ? window.innerHeight : 800)

  const snap = gridTicks(snapDiv, doc.ppq)
  const player = useRef<ScorePlayer | null>(null)
  const audioLane = useRef<AudioLaneHandle | null>(null)
  const liveSynth = useRef<VoiceInstrument | null>(null)
  const playheadRef = useRef(0)
  const recStart = useRef<Map<number, number>>(new Map())
  const pressed = useRef<Set<string>>(new Set())
  const fileRef = useRef<HTMLInputElement>(null)

  // keep latest values addressable from imperative event handlers
  const live = useRef({ recording, playing, caretTick, snap, instrument: track.instrument, ti })
  live.current = { recording, playing, caretTick, snap, instrument: track.instrument, ti }

  /* ── live synth for held notes ── */
  useEffect(() => {
    liveSynth.current = makeSynth(track.instrument)
    return () => {
      liveSynth.current?.dispose()
      liveSynth.current = null
    }
  }, [track.instrument])

  /* ── transport ── */
  useEffect(() => {
    const p = new ScorePlayer()
    p.setOnTick((sec) => {
      const tick = secondsToTicks(sec, doc.tempo, doc.ppq)
      playheadRef.current = tick
      setPlayheadTick(Math.max(0, tick)) // clamp during count-in (sec < 0)
    })
    p.setOnEnd(() => {
      setPlaying(false)
      setPlayheadTick(null)
    })
    player.current = p
    return () => p.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stop = useCallback(() => {
    player.current?.stop()
    audioLane.current?.stop()
    setPlaying(false)
    setPlayheadTick(null)
  }, [])

  const play = useCallback(async () => {
    if (playing) {
      stop()
      return
    }
    setPlaying(true)
    const audible = (t: { id: string }) => (solo ? t.id === solo : !muted.has(t.id))
    const playDoc = { ...editor.doc, tracks: editor.doc.tracks.filter(audible) }
    const countInBeats = countIn ? editor.doc.timeSig[0] : 0
    const loopOpt = loop.enabled && loop.endTick > loop.startTick ? { startTick: loop.startTick, endTick: loop.endTick } : undefined
    await player.current?.play(playDoc, 0, { metronome, countInBeats, loop: loopOpt })
    audioLane.current?.play()
  }, [playing, stop, editor.doc, solo, muted, metronome, countIn, loop])

  /* ── note input (shared by computer keyboard + WebMIDI) ── */
  const noteOn = useCallback(
    (pitch: number, vel = 100) => {
      const { recording, playing, caretTick, snap, instrument, ti } = live.current
      if (recording && playing) {
        recStart.current.set(pitch, playheadRef.current)
        liveSynth.current?.triggerAttack(midiToName(pitch), Tone.now(), vel / 127)
      } else {
        // step input
        editor.addNote({ pitch, start: caretTick, dur: snap, vel }, ti)
        setCaretTick(caretTick + snap)
        void ScorePlayer.preview(instrument, pitch, 0.35, vel / 127)
      }
    },
    [editor],
  )

  const noteOff = useCallback(
    (pitch: number) => {
      const { snap, ti } = live.current
      liveSynth.current?.triggerRelease(midiToName(pitch))
      const start = recStart.current.get(pitch)
      if (start == null) return
      recStart.current.delete(pitch)
      const end = playheadRef.current
      const qStart = Math.max(0, quantize(start, snap))
      const qDur = Math.max(snap, quantize(end - qStart, snap))
      editor.addNote({ pitch, start: qStart, dur: qDur, vel: 100 }, ti)
    },
    [editor],
  )

  /* ── selection ops (operate on the active track) ── */
  const mapActive = useCallback(
    (fn: (notes: typeof track.notes) => typeof track.notes) =>
      editor.commit((d) => ({
        ...d,
        tracks: d.tracks.map((t, i) => (i === ti ? { ...t, notes: fn(t.notes) } : t)),
      })),
    [editor, ti],
  )

  const selectAll = useCallback(() => setSelection(new Set(track.notes.map((n) => n.id))), [track.notes])

  const quantizeSelection = useCallback(() => {
    if (!selection.size) return
    mapActive((notes) => notes.map((n) => (selection.has(n.id) ? { ...n, start: quantize(n.start, snap) } : n)))
  }, [selection, snap, mapActive])

  const transposeSelection = useCallback(
    (delta: number) => {
      if (!selection.size) return
      mapActive((notes) =>
        notes.map((n) => (selection.has(n.id) ? { ...n, pitch: Math.max(0, Math.min(127, n.pitch + delta)) } : n)),
      )
    },
    [selection, mapActive],
  )

  const nudgeSelection = useCallback(
    (delta: number) => {
      if (!selection.size) return
      mapActive((notes) => notes.map((n) => (selection.has(n.id) ? { ...n, start: Math.max(0, n.start + delta) } : n)))
    },
    [selection, mapActive],
  )

  const duplicateSelection = useCallback(() => {
    const picked = track.notes.filter((n) => selection.has(n.id))
    if (!picked.length) return
    const minS = Math.min(...picked.map((n) => n.start))
    const maxE = Math.max(...picked.map((n) => n.start + n.dur))
    const shift = Math.max(snap, maxE - minS)
    const copies = picked.map((n) => ({ ...n, id: uid('n'), start: n.start + shift }))
    mapActive((notes) => [...notes, ...copies])
    setSelection(new Set(copies.map((c) => c.id)))
  }, [track.notes, selection, snap, mapActive])

  const toggleLoop = useCallback(() => {
    setLoop((l) => {
      if (l.enabled) return { ...l, enabled: false }
      const bar = ticksPerBar(doc.timeSig, doc.ppq)
      const start = l.endTick > l.startTick ? l.startTick : 0
      const end = l.endTick > l.startTick ? l.endTick : 4 * bar
      return { startTick: start, endTick: end, enabled: true }
    })
  }, [doc.timeSig, doc.ppq])

  /* ── computer keyboard ── */
  useEffect(() => {
    const isField = (t: EventTarget | null) =>
      t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)

    const onKeyDown = (e: KeyboardEvent) => {
      if (isField(e.target)) return
      const meta = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (meta) {
        // Ableton-style command shortcuts
        if (k === 'z') {
          e.preventDefault()
          e.shiftKey ? editor.redo() : editor.undo()
        } else if (k === 'a') {
          e.preventDefault()
          selectAll()
        } else if (k === 'd') {
          e.preventDefault()
          duplicateSelection()
        } else if (k === 'u') {
          e.preventDefault()
          quantizeSelection()
        } else if (k === 'l') {
          e.preventDefault()
          toggleLoop()
        } else if (k === '1') {
          e.preventDefault()
          setSnapDiv((d) => SNAP_DIVISIONS[Math.min(SNAP_DIVISIONS.length - 1, SNAP_DIVISIONS.indexOf(d) + 1)])
        } else if (k === '2') {
          e.preventDefault()
          setSnapDiv((d) => SNAP_DIVISIONS[Math.max(0, SNAP_DIVISIONS.indexOf(d) - 1)])
        }
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection.size) {
          e.preventDefault()
          editor.removeNotes([...selection], ti)
          setSelection(new Set())
        }
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        play()
        return
      }
      // arrow keys (piano roll only; tab owns its own caret). With a selection
      // they nudge/transpose it; with nothing selected they drive a keyboard
      // entry workflow — ←/→ move the step-input caret, ↑/↓ shift the octave.
      if (track.kind !== 'tab' && e.key.startsWith('Arrow')) {
        e.preventDefault()
        if (selection.size) {
          if (e.key === 'ArrowLeft') nudgeSelection(-snap)
          else if (e.key === 'ArrowRight') nudgeSelection(snap)
          else if (e.key === 'ArrowUp') transposeSelection(e.shiftKey ? 12 : 1)
          else if (e.key === 'ArrowDown') transposeSelection(e.shiftKey ? -12 : -1)
        } else {
          if (e.key === 'ArrowLeft') setCaretTick((c) => Math.max(0, c - snap))
          else if (e.key === 'ArrowRight') setCaretTick((c) => c + snap)
          else if (e.key === 'ArrowUp') setOctave((o) => Math.min(8, o + 1))
          else if (e.key === 'ArrowDown') setOctave((o) => Math.max(0, o - 1))
        }
        return
      }
      if (k === 'b') return setDrawMode((d) => !d)
      if (track.kind === 'tab') return // tab uses on-screen frets, not the QWERTY keys
      if (e.key === 'z') return setOctave((o) => Math.max(0, o - 1))
      if (e.key === 'x') return setOctave((o) => Math.min(8, o + 1))
      const semi = KEY_SEMITONE[e.key.toLowerCase()]
      if (semi != null && !e.repeat && !pressed.current.has(e.key)) {
        pressed.current.add(e.key)
        noteOn((octave + 1) * 12 + semi)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const semi = KEY_SEMITONE[e.key.toLowerCase()]
      if (semi != null && pressed.current.has(e.key)) {
        pressed.current.delete(e.key)
        noteOff((octave + 1) * 12 + semi)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [editor, noteOn, noteOff, octave, selection, play, track.kind, snap, selectAll, duplicateSelection, quantizeSelection, toggleLoop, nudgeSelection, transposeSelection])

  /* ── WebMIDI ── */
  const connectMidi = useCallback(async () => {
    if (!navigator.requestMIDIAccess) return
    try {
      const access = await navigator.requestMIDIAccess()
      setMidiOn(true)
      access.inputs.forEach((input) => {
        input.onmidimessage = (msg) => {
          if (!msg.data) return
          const [status, pitch, vel] = msg.data as Uint8Array
          const cmd = status & 0xf0
          if (cmd === 0x90 && vel > 0) noteOn(pitch, vel)
          else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) noteOff(pitch)
        }
      })
    } catch {
      setMidiOn(false)
    }
  }, [noteOn, noteOff])

  /* ── import / export ── */
  const onExport = () => downloadMidi(editor.doc, name || 'score')
  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    const imported = midiToDoc(buf)
    editor.commit((d) => ({ ...imported, tempo: imported.tempo || d.tempo }))
    e.target.value = ''
  }
  const saveToProject = async () => {
    setSavedMsg('Saving…')
    try {
      const bytes = docToMidi(editor.doc)
      const fd = new FormData()
      fd.append('file', new File([bytes as unknown as BlobPart], `${name || 'score'}.mid`, { type: 'audio/midi' }))
      fd.append('interest_id', interestId)
      await api.upload('/media', fd)
      setSavedMsg('Saved to project ✓')
    } catch {
      setSavedMsg('Save failed')
    }
    setTimeout(() => setSavedMsg(''), 2500)
  }

  /* ── tracks ── */
  const addTrack = () => {
    editor.commit((d) => ({
      ...d,
      tracks: [
        ...d.tracks,
        { id: uid('t'), name: `Track ${d.tracks.length + 1}`, kind: track.kind, instrument: 'pluck', notes: [], ...(track.kind === 'tab' ? { tuning: track.tuning } : {}) },
      ],
    }))
    setActiveTrack(doc.tracks.length)
  }
  const removeTrack = (id: string) => {
    if (doc.tracks.length <= 1) return
    editor.commit((d) => ({ ...d, tracks: d.tracks.filter((t) => t.id !== id) }))
    setActiveTrack(0)
    setMuted((m) => {
      const n = new Set(m)
      n.delete(id)
      return n
    })
    if (solo === id) setSolo(null)
  }
  const renameTrack = (id: string) => {
    const cur = doc.tracks.find((t) => t.id === id)
    const nm = window.prompt('Rename track', cur?.name)
    if (!nm) return
    editor.commit((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, name: nm } : t)) }))
  }
  const toggleMute = (id: string) =>
    setMuted((m) => {
      const n = new Set(m)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  const toggleSolo = (id: string) => setSolo((s) => (s === id ? null : id))

  const ghostTracks = useMemo(() => doc.tracks.filter((_, i) => i !== ti), [doc.tracks, ti])

  const zoom = (factor: number) => setPxPerTick((p) => Math.max(0.01, Math.min(0.6, p * factor)))
  const zoomV = (delta: number) =>
    setRowH((h) => {
      const i = ROW_HEIGHTS.indexOf(h)
      const ni = Math.max(0, Math.min(ROW_HEIGHTS.length - 1, (i < 0 ? 2 : i) + delta))
      return ROW_HEIGHTS[ni]
    })

  // Track viewport height so the piano-roll grid fills the screen in fullscreen.
  useEffect(() => {
    if (!fullscreen) return
    const onR = () => setWinH(window.innerHeight)
    onR()
    window.addEventListener('resize', onR)
    window.addEventListener('orientationchange', onR)
    return () => {
      window.removeEventListener('resize', onR)
      window.removeEventListener('orientationchange', onR)
    }
  }, [fullscreen])
  // ~270px reserved for the toolbar, track strip, ruler, velocity + lyric lanes.
  const gridViewH = fullscreen ? Math.max(220, winH - 270) : 360

  return (
    <div className={fullscreen ? 'min-h-full p-2 sm:p-3 space-y-2' : 'space-y-3'}>
      {/* Toolbar — primary controls (one scrollable row, never a wall) */}
      <div className="tab-strip items-center gap-2 text-xs shrink-0">
        <button className="btn-ghost flex items-center gap-1 py-1" onClick={onBack}>
          <ChevronLeft size={13} /> Scores
        </button>
        <span className="font-medium text-text-1 truncate max-w-[10rem]">{name}</span>

        <button
          className="w-7 h-7 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center text-white"
          onClick={play}
          aria-label={playing ? 'Stop' : 'Play'}
        >
          {playing ? <Square size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" className="ml-0.5" />}
        </button>
        <button
          className={`w-7 h-7 rounded-full flex items-center justify-center border ${
            recording ? 'bg-danger text-white border-danger' : 'border-bg-3 text-text-3 hover:text-danger'
          }`}
          onClick={() => setRecording((r) => !r)}
          title="Arm recording (records held keys/MIDI while playing)"
        >
          <Circle size={11} fill={recording ? 'currentColor' : 'none'} />
        </button>

        <label className="flex items-center gap-1 text-text-3">
          BPM
          <input
            type="number"
            min={20}
            max={300}
            value={doc.tempo}
            onChange={(e) => editor.setTempo(Number(e.target.value))}
            className="input w-14 py-0.5 h-auto"
          />
        </label>

        <label className="flex items-center gap-1 text-text-3">
          Snap 1/
          <select
            className="input py-0.5 h-auto"
            value={snapDiv}
            onChange={(e) => setSnapDiv(Number(e.target.value))}
          >
            {SNAP_DIVISIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        {track.kind !== 'tab' && (
          <button
            className={`btn-ghost px-1.5 py-0.5 flex items-center gap-1 ${drawMode && !eraseMode ? 'text-accent' : 'text-text-3'}`}
            onClick={() => { setDrawMode((d) => !d); setEraseMode(false) }}
            title="Draw mode (B) — paint vs. select/edit"
          >
            <Pencil size={12} /> Draw
          </button>
        )}
        {track.kind !== 'tab' && (
          <button
            className={`btn-ghost px-1.5 py-0.5 flex items-center gap-1 ${eraseMode ? 'text-danger' : 'text-text-3'}`}
            onClick={() => setEraseMode((x) => !x)}
            title="Eraser — tap a note to delete it"
          >
            <Eraser size={12} /> Erase
          </button>
        )}
        {fullscreen && (
          <button
            className={`btn-ghost px-2 py-0.5 flex items-center gap-1 ${showTools ? 'text-accent' : 'text-text-3'}`}
            onClick={() => setShowTools((s) => !s)}
            title="More tools"
          >
            <Sliders size={12} /> Tools
          </button>
        )}
        <input ref={fileRef} type="file" accept=".mid,.midi" hidden onChange={onImportFile} />
      </div>

      {/* Toolbar — secondary controls (wrap onto their own row; collapsible in fullscreen) */}
      {(!fullscreen || showTools) && (
      <div className="flex flex-wrap items-center gap-2 text-xs shrink-0">
        <button
          className={`btn-ghost px-1.5 py-0.5 flex items-center gap-1 ${loop.enabled ? 'text-accent' : 'text-text-3'}`}
          onClick={toggleLoop}
          title="Loop (⌘L) — drag the ruler to set the region"
        >
          <Repeat size={12} /> Loop
        </button>
        <button
          className={`btn-ghost px-2 py-0.5 ${metronome ? 'text-accent' : 'text-text-3'}`}
          onClick={() => setMetronome((m) => !m)}
          title="Metronome"
        >
          Metro
        </button>
        <button
          className={`btn-ghost px-2 py-0.5 ${countIn ? 'text-accent' : 'text-text-3'}`}
          onClick={() => setCountIn((c) => !c)}
          title="One-bar count-in before playback/recording"
        >
          Count-in
        </button>
        {track.kind !== 'tab' && (
          <>
            <button
              className="btn-ghost px-1.5 py-0.5 flex items-center gap-1 text-text-3 disabled:opacity-30"
              onClick={duplicateSelection}
              disabled={!selection.size}
              title="Duplicate selection (⌘D)"
            >
              <Copy size={12} /> Dup
            </button>
            <button
              className="btn-ghost px-1.5 py-0.5 flex items-center gap-1 text-text-3 disabled:opacity-30"
              onClick={quantizeSelection}
              disabled={!selection.size}
              title="Quantize selection (⌘U)"
            >
              <Magnet size={12} /> Q
            </button>
          </>
        )}

        <label className="flex items-center gap-1 text-text-3">
          Inst
          <select
            className="input py-0.5 h-auto"
            value={track.instrument}
            onChange={(e) => editor.setInstrument(e.target.value, ti)}
          >
            {INSTRUMENTS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </label>

        <span className="flex items-center gap-1 text-text-3">
          Oct
          <button className="btn-ghost px-1.5 py-0.5" onClick={() => setOctave((o) => Math.max(0, o - 1))}>
            −
          </button>
          <span className="w-4 text-center tabular-nums text-text-2">{octave}</span>
          <button className="btn-ghost px-1.5 py-0.5" onClick={() => setOctave((o) => Math.min(8, o + 1))}>
            +
          </button>
        </span>

        <div className="flex items-center gap-1">
          <button className="text-text-3 hover:text-text-1" onClick={() => zoom(0.8)} title="Zoom out (time)">
            <ZoomOut size={14} />
          </button>
          <button className="text-text-3 hover:text-text-1" onClick={() => zoom(1.25)} title="Zoom in (time)">
            <ZoomIn size={14} />
          </button>
          {track.kind !== 'tab' && (
            <span className="flex items-center text-text-3 ml-1">
              <button className="hover:text-text-1 px-0.5" onClick={() => zoomV(-1)} title="Shorter rows">
                −
              </button>
              <span className="text-[10px]">rows</span>
              <button className="hover:text-text-1 px-0.5" onClick={() => zoomV(1)} title="Taller rows">
                +
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          <button
            className="text-text-3 hover:text-text-1 disabled:opacity-30"
            onClick={editor.undo}
            disabled={!editor.canUndo}
            title="Undo"
          >
            <Undo2 size={14} />
          </button>
          <button
            className="text-text-3 hover:text-text-1 disabled:opacity-30"
            onClick={editor.redo}
            disabled={!editor.canRedo}
            title="Redo"
          >
            <Redo2 size={14} />
          </button>
          <button
            className={`btn-ghost py-1 flex items-center gap-1 ${showSing ? 'text-accent' : ''}`}
            onClick={() => setShowSing((s) => !s)}
            title="Sing to notes"
          >
            <Mic size={12} /> Sing
          </button>
          {!midiOn && (
            <button className="btn-ghost py-1" onClick={connectMidi}>
              MIDI
            </button>
          )}
          {midiOn && <span className="text-green-400">MIDI ✓</span>}
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> Import
          </button>
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={onExport}>
            <Download size={12} /> Export
          </button>
          <button className="btn-ghost flex items-center gap-1 py-1" onClick={saveToProject} title="Save a .mid copy into this project's media">
            <Save size={12} /> To project
          </button>
          <span className="text-text-3 w-16">{savedMsg || (editor.dirty ? 'Saving…' : 'Saved')}</span>
        </div>
      </div>
      )}

      {/* Track strip */}
      <div className="tab-strip items-center gap-1.5 text-xs shrink-0">
        {doc.tracks.map((t, i) => {
          const isMuted = solo ? solo !== t.id : muted.has(t.id)
          return (
            <div
              key={t.id}
              onClick={() => setActiveTrack(i)}
              className={`flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md border cursor-pointer ${
                i === ti ? 'border-accent bg-accent/10 text-text-1' : 'border-bg-3 text-text-2 hover:border-accent/40'
              } ${isMuted ? 'opacity-50' : ''}`}
            >
              <span onDoubleClick={() => renameTrack(t.id)} className="truncate max-w-[8rem]">
                {t.name}
              </span>
              <button
                className={`px-1 rounded ${muted.has(t.id) ? 'text-danger' : 'text-text-3 hover:text-text-1'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleMute(t.id)
                }}
                title="Mute"
              >
                {muted.has(t.id) ? <VolumeX size={12} /> : <Volume2 size={12} />}
              </button>
              <button
                className={`px-1 rounded text-[10px] font-bold ${solo === t.id ? 'text-accent' : 'text-text-3 hover:text-text-1'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  toggleSolo(t.id)
                }}
                title="Solo"
              >
                S
              </button>
              {doc.tracks.length > 1 && (
                <button
                  className="px-1 text-text-3 hover:text-danger"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTrack(t.id)
                  }}
                  title="Delete track"
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>
          )
        })}
        <button className="btn-ghost flex items-center gap-1 py-1 px-2" onClick={addTrack}>
          <Plus size={12} /> Track
        </button>
      </div>

      {showSing && (
        <SingCapture
          doc={doc}
          editor={editor}
          trackIndex={ti}
          snap={snap}
          caretTick={caretTick}
          onClose={() => setShowSing(false)}
        />
      )}

      {/* Audio-align lane is secondary on mobile — keep it mounted (its ref is
          used by transport) but hide it unless Tools is open in fullscreen. */}
      <div className={fullscreen && !showTools ? 'hidden' : ''}>
        <AudioAlignLane
          ref={audioLane}
          interestId={interestId}
          doc={doc}
          editor={editor}
          pxPerTick={pxPerTick}
          scrollLeft={scrollLeft}
          playheadTick={playheadTick}
        />
      </div>

      {/* a small left gutter keeps the ruler aligned with the grid (keys column) */}
      <div className="flex items-stretch gap-0" style={{ paddingLeft: track.kind === 'tab' ? 34 : 50 }}>
        <div className="flex-1">
          <TimeRuler
            doc={doc}
            pxPerTick={pxPerTick}
            scrollLeft={scrollLeft}
            loop={loop}
            onLoopChange={setLoop}
            caretTick={caretTick}
            onCaretChange={setCaretTick}
            playheadTick={playheadTick}
          />
        </div>
      </div>

      {track.kind === 'tab' ? (
        <TabEditor
          doc={doc}
          editor={editor}
          trackIndex={ti}
          pxPerTick={pxPerTick}
          playheadTick={playheadTick}
          onCaretChange={setCaretTick}
          onScrollLeft={setScrollLeft}
          onZoomTime={zoom}
        />
      ) : (
        <>
          <PianoRoll
            doc={doc}
            trackIndex={ti}
            editor={editor}
            pxPerTick={pxPerTick}
            rowH={rowH}
            snap={snap}
            drawMode={drawMode}
            playheadTick={playheadTick}
            caretTick={caretTick}
            onCaretChange={setCaretTick}
            selection={selection}
            onSelectionChange={setSelection}
            onScrollLeft={setScrollLeft}
            ghostTracks={ghostTracks}
            viewH={gridViewH}
            eraseMode={eraseMode}
            onZoomTime={zoom}
          />
          <div style={{ paddingLeft: 50 }}>
            <VelocityLane
              doc={doc}
              editor={editor}
              trackIndex={ti}
              pxPerTick={pxPerTick}
              scrollLeft={scrollLeft}
              selection={selection}
            />
          </div>
        </>
      )}

      <LyricLane
        interestId={interestId}
        doc={doc}
        editor={editor}
        trackIndex={ti}
        pxPerTick={pxPerTick}
        scrollLeft={scrollLeft}
      />

      <p className="text-xs text-text-3 hidden sm:block">
        {drawMode ? 'Draw mode' : 'Edit mode'} (B) · click a note = select & drag · edge = resize ·
        dbl-click a note = delete · {drawMode ? 'click empty = paint' : 'dbl-click empty = add · drag empty = marquee'} ·
        keys <kbd>a w s e d…</kbd> drop notes at the caret · ←/→ move caret · ↑/↓ octave ·
        with a selection arrows nudge/transpose · ⌘D dup · ⌘U quantize · ⌘L loop · arm ● then play to record.
      </p>
    </div>
  )
}
