// Shared "score document" — the single structure every music editor (piano roll,
// tab, sing-to-notes) reads and writes. Timing is tick-based (ppq ticks per
// quarter note) so MIDI export is lossless and independent of tempo.

export interface ScoreNote {
  id: string
  pitch: number // MIDI note number 0–127
  start: number // ticks from song start
  dur: number // length in ticks
  vel: number // velocity 1–127
  string?: number // tab only — 0 = lowest string
  fret?: number // tab only
  lyric?: string // syllable bound to this note (feature: notes ↔ lyrics)
}

export interface Track {
  id: string
  name: string
  kind: 'midi' | 'tab'
  instrument: string // synth preset id, see synth.ts INSTRUMENTS
  tuning?: string[] // tab only, low→high e.g. ['E2','A2','D3','G3','B3','E4']
  notes: ScoreNote[]
}

export interface AudioLink {
  assetId: string
  offsetMs: number // where tick 0 sits relative to the audio's start
}

export interface LoopRegion {
  startTick: number
  endTick: number
  enabled: boolean
}

export interface ScoreDoc {
  v: 1
  ppq: number
  tempo: number // bpm
  timeSig: [number, number]
  tracks: Track[]
  audioLink?: AudioLink
  loop?: LoopRegion
}

// ── Arrangement (clip timeline) ──────────────────────────────────────────
export interface ArrangementClip {
  id: string
  scoreId: string
  name: string
  lane: number
  startTick: number
  lengthTick: number
}

export interface ArrangementDoc {
  v: 1
  ppq: number
  tempo: number
  timeSig: [number, number]
  lanes: number
  clips: ArrangementClip[]
}

export const DEFAULT_PPQ = 480

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_PCS = new Set([1, 3, 6, 8, 10])

function mod12(n: number): number {
  return ((n % 12) + 12) % 12
}

/** MIDI number → scientific pitch name (60 → "C4"). */
export function midiToName(midi: number): string {
  return `${NOTE_NAMES[mod12(midi)]}${Math.floor(midi / 12) - 1}`
}

/** Scientific pitch name → MIDI number ("C4" → 60). */
export function nameToMidi(name: string): number {
  const m = /^([A-Ga-g]#?)(-?\d+)$/.exec(name.trim())
  if (!m) return 60
  const idx = NOTE_NAMES.indexOf(m[1].toUpperCase())
  if (idx < 0) return 60
  return (parseInt(m[2], 10) + 1) * 12 + idx
}

export function isBlackKey(midi: number): boolean {
  return BLACK_PCS.has(mod12(midi))
}

/** Seconds for a tick span at a given tempo. */
export function ticksToSeconds(ticks: number, tempo: number, ppq: number): number {
  return (ticks / ppq) * (60 / tempo)
}

export function secondsToTicks(sec: number, tempo: number, ppq: number): number {
  return ((sec * tempo) / 60) * ppq
}

/** Round a tick to the nearest grid step (grid given in ticks). */
export function quantize(tick: number, grid: number): number {
  if (grid <= 0) return Math.round(tick)
  return Math.round(tick / grid) * grid
}

/** Floor a tick to the grid step at or before it. */
export function snapDown(tick: number, grid: number): number {
  if (grid <= 0) return Math.floor(tick)
  return Math.floor(tick / grid) * grid
}

/** Ticks per grid division: division 4 = quarter, 8 = eighth, 16 = sixteenth. */
export function gridTicks(division: number, ppq: number): number {
  return (ppq * 4) / division
}

/** Ticks in one bar for the given time signature. */
export function ticksPerBar(timeSig: [number, number], ppq: number): number {
  const [num, den] = timeSig
  return num * ((ppq * 4) / den)
}

/** MIDI pitch sounded by fretting `fret` on string `stringIdx` (0 = lowest). */
export function fretToPitch(stringIdx: number, fret: number, tuning: string[]): number {
  return nameToMidi(tuning[stringIdx]) + fret
}

/** Fret required to play `pitch` on `stringIdx` (may be negative = unplayable). */
export function pitchToFret(pitch: number, stringIdx: number, tuning: string[]): number {
  return pitch - nameToMidi(tuning[stringIdx])
}

let _seq = 0
/** Short, collision-resistant id for notes/tracks. */
export function uid(prefix = 'n'): string {
  _seq = (_seq + 1) % 1e6
  return `${prefix}${Date.now().toString(36)}${_seq.toString(36)}`
}

export function emptyDoc(
  kind: 'midi' | 'tab',
  tempo = 120,
  timeSig: [number, number] = [4, 4],
): ScoreDoc {
  const track: Track = { id: uid('t'), name: 'Track 1', kind, instrument: 'pluck', notes: [] }
  if (kind === 'tab') track.tuning = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
  return { v: 1, ppq: DEFAULT_PPQ, tempo, timeSig, tracks: [track] }
}

/** Last tick occupied by any note (0 for an empty doc). */
export function docEndTick(doc: ScoreDoc): number {
  let end = 0
  for (const t of doc.tracks) {
    for (const n of t.notes) end = Math.max(end, n.start + n.dur)
  }
  return end
}

/** Round a tick up to the next bar boundary (min one bar). */
export function ceilToBar(tick: number, timeSig: [number, number], ppq: number): number {
  const bar = ticksPerBar(timeSig, ppq)
  return Math.max(bar, Math.ceil(tick / bar) * bar)
}

export function emptyArrangement(tempo = 120, timeSig: [number, number] = [4, 4]): ArrangementDoc {
  return { v: 1, ppq: DEFAULT_PPQ, tempo, timeSig, lanes: 4, clips: [] }
}

/** All notes of a score flattened across its tracks (pitch/start/dur/vel only). */
function flattenNotes(doc: ScoreDoc): ScoreNote[] {
  return doc.tracks.flatMap((t) => t.notes)
}

/**
 * Render an arrangement to a single playable/exportable ScoreDoc: each clip's
 * source score is repeated to fill its length (notes past the clip end are
 * truncated), grouped into one track per lane.
 */
export function buildArrangementDoc(arr: ArrangementDoc, sources: Record<string, ScoreDoc>): ScoreDoc {
  const laneTracks: Track[] = Array.from({ length: Math.max(1, arr.lanes) }, (_, i) => ({
    id: uid('t'),
    name: `Lane ${i + 1}`,
    kind: 'midi' as const,
    instrument: 'pluck',
    notes: [],
  }))
  const assigned = new Set<number>()

  for (const clip of arr.clips) {
    const src = sources[clip.scoreId]
    if (!src) continue
    const laneIdx = Math.min(clip.lane, laneTracks.length - 1)
    const lane = laneTracks[laneIdx]
    if (!assigned.has(laneIdx)) {
      lane.instrument = src.tracks[0]?.instrument ?? 'pluck'
      assigned.add(laneIdx)
    }
    const srcNotes = flattenNotes(src)
    const srcLen = ceilToBar(docEndTick(src), arr.timeSig, arr.ppq)
    const clipEnd = clip.startTick + clip.lengthTick
    for (let repStart = clip.startTick; repStart < clipEnd; repStart += srcLen) {
      for (const n of srcNotes) {
        const start = repStart + n.start
        if (start >= clipEnd) continue
        const dur = Math.min(n.dur, clipEnd - start)
        if (dur <= 0) continue
        lane.notes.push({ id: uid('n'), pitch: n.pitch, start, dur, vel: n.vel })
      }
    }
  }

  return {
    v: 1,
    ppq: arr.ppq,
    tempo: arr.tempo,
    timeSig: arr.timeSig,
    tracks: laneTracks,
  }
}
