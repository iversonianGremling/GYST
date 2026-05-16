import { useEffect, useRef, useState, useCallback } from 'react'
import * as Tone from 'tone'

/* ── Piano layout ─────────────────────────────────────────────────── */
// Two octaves starting from C3
const OCTAVES = [3, 4]
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const BLACK_AFTER = { C: 'C#', D: 'D#', F: 'F#', G: 'G#', A: 'A#' } as Record<string, string>

interface KeyDef { note: string; type: 'white' | 'black'; label: string }

function buildKeys(): KeyDef[] {
  const keys: KeyDef[] = []
  for (const oct of OCTAVES) {
    for (const n of WHITE_NOTES) {
      keys.push({ note: `${n}${oct}`, type: 'white', label: n === 'C' ? `C${oct}` : '' })
      if (BLACK_AFTER[n]) {
        keys.push({ note: `${BLACK_AFTER[n]}${oct}`, type: 'black', label: '' })
      }
    }
  }
  return keys
}

const ALL_KEYS = buildKeys()
const WHITE_KEYS = ALL_KEYS.filter((k) => k.type === 'white')

const INSTRUMENTS = [
  { label: 'Synth',     value: 'synth' },
  { label: 'Piano',     value: 'piano' },
  { label: 'Organ',     value: 'organ' },
  { label: 'Pad',       value: 'pad' },
]

/* ── MIDI note → Tone.js note string ─────────────────────────────── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOpts = any

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiToNote(midi: number): string {
  return `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/* ── Synth factory ────────────────────────────────────────────────── */
function makeSynth(kind: string): Tone.PolySynth {
  const opts: AnyOpts = kind === 'piano'
    ? { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 1.2 } }
    : kind === 'organ'
    ? { oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 } }
    : kind === 'pad'
    ? { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 1.5 } }
    : { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.8 } }
  return new Tone.PolySynth(Tone.Synth, opts).toDestination()
}

export default function SynthPad() {
  const synthRef    = useRef<Tone.PolySynth | null>(null)
  const midiRef     = useRef<MIDIAccess | null>(null)

  const [instrument, setInstrument] = useState('synth')
  const [midiInputs, setMidiInputs] = useState<{ id: string; name: string }[]>([])
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set())
  const [midiStatus, setMidiStatus] = useState<'unsupported' | 'denied' | 'ready' | 'idle'>('idle')
  const [volume, setVolume] = useState(-6) // dB

  /* ── Init synth ── */
  useEffect(() => {
    synthRef.current = makeSynth(instrument)
    synthRef.current.volume.value = volume
    return () => { synthRef.current?.dispose() }
  }, [instrument]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (synthRef.current) synthRef.current.volume.value = volume
  }, [volume])

  /* ── Web MIDI ── */
  const connectMidi = useCallback(async () => {
    if (!navigator.requestMIDIAccess) { setMidiStatus('unsupported'); return }
    try {
      const access = await navigator.requestMIDIAccess()
      midiRef.current = access
      const inputs = Array.from(access.inputs.values()).map((i) => ({ id: i.id, name: i.name ?? 'Unknown' }))
      setMidiInputs(inputs)
      setMidiStatus('ready')

      access.inputs.forEach((input) => {
        input.onmidimessage = (msg) => {
          if (!msg.data) return
          const data = msg.data as Uint8Array
          const [status, note, velocity] = data
          const cmd = status & 0xf0
          const noteStr = midiToNote(note)
          if (cmd === 0x90 && velocity > 0) {   // note on
            synthRef.current?.triggerAttack(noteStr, Tone.now(), velocity / 127)
            setActiveNotes((prev) => new Set([...prev, noteStr]))
          } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {  // note off
            synthRef.current?.triggerRelease(noteStr)
            setActiveNotes((prev) => { const s = new Set(prev); s.delete(noteStr); return s })
          }
        }
      })

      access.onstatechange = () => {
        const inputs = Array.from(access.inputs.values()).map((i) => ({ id: i.id, name: i.name ?? 'Unknown' }))
        setMidiInputs(inputs)
      }
    } catch {
      setMidiStatus('denied')
    }
  }, [])

  /* ── Piano key handlers ── */
  const attack = useCallback(async (note: string) => {
    await Tone.start()
    synthRef.current?.triggerAttack(note)
    setActiveNotes((prev) => new Set([...prev, note]))
  }, [])

  const release = useCallback((note: string) => {
    synthRef.current?.triggerRelease(note)
    setActiveNotes((prev) => { const s = new Set(prev); s.delete(note); return s })
  }, [])

  /* ── White key width for black key positioning ── */
  const wCount = WHITE_KEYS.length // 14

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <label className="text-xs text-text-3 mb-1 block">Instrument</label>
          <select className="input text-sm py-1 h-auto" value={instrument}
            onChange={(e) => setInstrument(e.target.value)}>
            {INSTRUMENTS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-text-3 mb-1 block">Volume ({volume} dB)</label>
          <input type="range" min={-40} max={0} value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-28" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-text-3">MIDI</span>
          {midiStatus === 'idle' && (
            <button className="btn-ghost text-xs py-1" onClick={connectMidi}>Connect MIDI</button>
          )}
          {midiStatus === 'ready' && midiInputs.length === 0 && (
            <span className="text-xs text-text-3">No devices found</span>
          )}
          {midiStatus === 'ready' && midiInputs.length > 0 && (
            <span className="text-xs text-green-400">{midiInputs.map((i) => i.name).join(', ')}</span>
          )}
          {midiStatus === 'denied' && <span className="text-xs text-danger">Access denied</span>}
          {midiStatus === 'unsupported' && <span className="text-xs text-text-3">Not supported in this browser</span>}
        </div>
      </div>

      {/* Piano keyboard */}
      <div
        className="relative select-none overflow-x-auto"
        style={{ height: 100 }}
      >
        <div className="relative" style={{ width: `${wCount * 36}px`, height: '100%' }}>
          {/* White keys */}
          {WHITE_KEYS.map((k, i) => (
            <div
              key={k.note}
              onMouseDown={() => attack(k.note)}
              onMouseUp={() => release(k.note)}
              onMouseLeave={() => release(k.note)}
              onTouchStart={(e) => { e.preventDefault(); attack(k.note) }}
              onTouchEnd={() => release(k.note)}
              className="absolute top-0 bottom-0 rounded-b-md border border-bg-3 cursor-pointer flex items-end justify-center pb-1 transition-colors"
              style={{
                left: i * 36,
                width: 34,
                background: activeNotes.has(k.note)
                  ? 'var(--color-accent-dim)'
                  : 'white',
              }}
            >
              {k.label && <span className="text-[9px] text-gray-400">{k.label}</span>}
            </div>
          ))}

          {/* Black keys */}
          {(() => {
            // Map black key notes to their white-key offset positions
            let wIdx = -1
            return ALL_KEYS.map((k) => {
              if (k.type === 'white') { wIdx++; return null }
              const x = wIdx * 36 + 22
              return (
                <div
                  key={k.note}
                  onMouseDown={(e) => { e.stopPropagation(); attack(k.note) }}
                  onMouseUp={() => release(k.note)}
                  onMouseLeave={() => release(k.note)}
                  onTouchStart={(e) => { e.preventDefault(); attack(k.note) }}
                  onTouchEnd={() => release(k.note)}
                  className="absolute top-0 z-10 rounded-b-md cursor-pointer transition-colors"
                  style={{
                    left: x,
                    width: 24,
                    height: 60,
                    background: activeNotes.has(k.note)
                      ? 'var(--color-accent)'
                      : '#1a1a2e',
                  }}
                />
              )
            })
          })()}
        </div>
      </div>

      <p className="text-xs text-text-3">Click keys or connect a MIDI controller to play.</p>
    </div>
  )
}
