// Instruments for the composer. Besides the basic Tone.js subtractive presets,
// the default is a Karplus–Strong plucked string (Tone.PluckSynth): a short
// noise burst fed through a damped feedback delay — cheap and far more
// string/guitar-like than a raw oscillator.
//
// PluckSynth is monophonic and can't live inside a PolySynth, so PluckInstrument
// is a tiny polyphonic voice-allocator: one short-lived PluckSynth per note,
// summed through a shared output, disposed once it has rung out.
import * as Tone from 'tone'
import { midiToName } from './types'

export const INSTRUMENTS = [
  { label: 'Pluck', value: 'pluck' },
  { label: 'Guitar', value: 'guitar' },
  { label: 'Bass', value: 'bass' },
  { label: 'Synth', value: 'synth' },
  { label: 'Piano', value: 'piano' },
  { label: 'Organ', value: 'organ' },
  { label: 'Pad', value: 'pad' },
] as const

/** The slice of an instrument the editor/transport actually calls. */
export interface VoiceInstrument {
  triggerAttack(note: string, time?: number, velocity?: number): void
  triggerRelease(note: string, time?: number): void
  triggerAttackRelease(note: string, duration: number, time?: number, velocity?: number): void
  readonly volume: { value: number }
  dispose(): void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOpts = any

type Voice = { voice: Tone.PluckSynth; gain: Tone.Gain }

class PluckInstrument implements VoiceInstrument {
  private out: Tone.Volume
  private all = new Set<Voice>()
  private byNote = new Map<string, Voice[]>()

  constructor(private opts: AnyOpts) {
    this.out = new Tone.Volume(0).toDestination()
  }

  get volume() {
    return this.out.volume
  }

  private spawn(velocity: number): Voice {
    const voice = new Tone.PluckSynth(this.opts)
    const gain = new Tone.Gain(Math.max(0.001, velocity))
    voice.connect(gain)
    gain.connect(this.out)
    const v = { voice, gain }
    this.all.add(v)
    return v
  }

  private kill(v: Voice): void {
    if (!this.all.has(v)) return
    this.all.delete(v)
    try {
      v.voice.dispose()
      v.gain.dispose()
    } catch {
      /* already disposed */
    }
  }

  triggerAttack(note: string, time?: number, velocity = 0.8): void {
    const v = this.spawn(velocity)
    v.voice.triggerAttack(note, time)
    const arr = this.byNote.get(note) ?? []
    arr.push(v)
    this.byNote.set(note, arr)
  }

  triggerRelease(note: string, time?: number): void {
    const arr = this.byNote.get(note)
    if (!arr || !arr.length) return
    const v = arr.shift()!
    const t = time ?? Tone.now()
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), t)
    v.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12)
    setTimeout(() => this.kill(v), 280)
  }

  triggerAttackRelease(note: string, duration: number, time?: number, velocity = 0.8): void {
    const t = time ?? Tone.now()
    const v = this.spawn(velocity)
    v.voice.triggerAttack(note, t)
    const end = t + duration
    v.gain.gain.setValueAtTime(Math.max(0.001, velocity), end)
    v.gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.1)
    const ms = Math.max(0, (end + 0.4 - Tone.now()) * 1000)
    setTimeout(() => this.kill(v), ms)
  }

  dispose(): void {
    this.all.forEach((v) => {
      try {
        v.voice.dispose()
        v.gain.dispose()
      } catch {
        /* ignore */
      }
    })
    this.all.clear()
    this.byNote.clear()
    this.out.dispose()
  }
}

// Karplus–Strong presets. `resonance` = feedback (sustain), `dampening` = string
// brightness (lowpass cutoff Hz), `attackNoise` = pluck transient amount.
const PLUCK_PRESETS: Record<string, AnyOpts> = {
  pluck: { attackNoise: 1, dampening: 4000, resonance: 0.95, release: 1 },
  guitar: { attackNoise: 2, dampening: 5400, resonance: 0.97, release: 1 },
  bass: { attackNoise: 1, dampening: 1800, resonance: 0.96, release: 1.4 },
}

export function makeSynth(kind: string): VoiceInstrument {
  const pluck = PLUCK_PRESETS[kind]
  if (pluck) return new PluckInstrument(pluck)

  const opts: AnyOpts =
    kind === 'piano'
      ? { oscillator: { type: 'triangle' }, envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 1.2 } }
      : kind === 'organ'
        ? { oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0, sustain: 1, release: 0.1 } }
        : kind === 'pad'
          ? { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.4, decay: 0.3, sustain: 0.7, release: 1.5 } }
          : { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.8 } }
  return new Tone.PolySynth(Tone.Synth, opts).toDestination() as unknown as VoiceInstrument
}

/** MIDI number → Tone.js note string. Kept for SynthPad's existing call sites. */
export function midiToNote(midi: number): string {
  return midiToName(midi)
}
