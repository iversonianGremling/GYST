// Standard MIDI file import/export so scores round-trip with Ableton and other
// DAWs. Uses @tonejs/midi. Timing is converted through ticks (not seconds) to
// stay lossless regardless of tempo.
import { Midi } from '@tonejs/midi'
import { DEFAULT_PPQ, ScoreDoc, Track, uid } from './types'

function scaleTicks(tick: number, fromPpq: number, toPpq: number): number {
  if (fromPpq === toPpq) return Math.round(tick)
  return Math.round((tick * toPpq) / fromPpq)
}

/** Serialise a ScoreDoc to a Standard MIDI File (bytes). */
export function docToMidi(doc: ScoreDoc): Uint8Array {
  const midi = new Midi()
  const destPpq = midi.header.ppq || DEFAULT_PPQ
  midi.header.setTempo(doc.tempo)
  try {
    midi.header.timeSignatures.push({
      ticks: 0,
      timeSignature: [doc.timeSig[0], doc.timeSig[1]],
      // measures is optional in the type but some versions expect it
      measures: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
  } catch {
    /* time signature is cosmetic for DAW import — ignore if the API differs */
  }

  for (const track of doc.tracks) {
    const t = midi.addTrack()
    t.name = track.name
    for (const n of track.notes) {
      t.addNote({
        midi: n.pitch,
        ticks: scaleTicks(n.start, doc.ppq, destPpq),
        durationTicks: scaleTicks(n.dur, doc.ppq, destPpq),
        velocity: Math.max(0, Math.min(1, n.vel / 127)),
      })
    }
  }
  return midi.toArray()
}

/** Parse a Standard MIDI File into a ScoreDoc (all tracks become 'midi'). */
export function midiToDoc(bytes: ArrayBuffer | Uint8Array): ScoreDoc {
  const midi = new Midi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  const srcPpq = midi.header.ppq || DEFAULT_PPQ
  const tempo = Math.round(midi.header.tempos[0]?.bpm ?? 120)
  const tsRaw = midi.header.timeSignatures[0]?.timeSignature
  const timeSig: [number, number] = tsRaw ? [tsRaw[0], tsRaw[1]] : [4, 4]

  const tracks: Track[] = midi.tracks
    .filter((t) => t.notes.length > 0)
    .map((t, i) => ({
      id: uid('t'),
      name: t.name || `Track ${i + 1}`,
      kind: 'midi' as const,
      instrument: 'synth',
      notes: t.notes.map((n) => ({
        id: uid('n'),
        pitch: n.midi,
        start: scaleTicks(n.ticks, srcPpq, DEFAULT_PPQ),
        dur: Math.max(1, scaleTicks(n.durationTicks, srcPpq, DEFAULT_PPQ)),
        vel: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
      })),
    }))

  if (tracks.length === 0) {
    tracks.push({ id: uid('t'), name: 'Track 1', kind: 'midi', instrument: 'synth', notes: [] })
  }

  return { v: 1, ppq: DEFAULT_PPQ, tempo, timeSig, tracks }
}

/** Trigger a browser download of a ScoreDoc as a .mid file. */
export function downloadMidi(doc: ScoreDoc, filename: string): void {
  const bytes = docToMidi(doc)
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'audio/midi' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.mid') ? filename : `${filename}.mid`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
