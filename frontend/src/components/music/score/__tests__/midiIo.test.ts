import { describe, it, expect } from 'vitest'
import { docToMidi, midiToDoc } from '../midiIo'
import { ScoreDoc } from '../types'

const doc: ScoreDoc = {
  v: 1,
  ppq: 480,
  tempo: 128,
  timeSig: [4, 4],
  tracks: [
    {
      id: 't1',
      name: 'Lead',
      kind: 'midi',
      instrument: 'synth',
      notes: [
        { id: 'n1', pitch: 60, start: 0, dur: 480, vel: 100 },
        { id: 'n2', pitch: 64, start: 480, dur: 240, vel: 80 },
        { id: 'n3', pitch: 67, start: 960, dur: 960, vel: 120 },
      ],
    },
  ],
}

describe('midi round-trip', () => {
  it('preserves tempo, pitches and timing', () => {
    const bytes = docToMidi(doc)
    expect(bytes.length).toBeGreaterThan(0)

    const back = midiToDoc(bytes)
    expect(back.tempo).toBe(128)
    expect(back.tracks).toHaveLength(1)

    const notes = back.tracks[0].notes.sort((a, b) => a.start - b.start)
    expect(notes.map((n) => n.pitch)).toEqual([60, 64, 67])
    expect(notes.map((n) => n.start)).toEqual([0, 480, 960])
    expect(notes.map((n) => n.dur)).toEqual([480, 240, 960])
    // velocity survives within a quantization step (0-127 vs 0-1 float)
    expect(Math.abs(notes[0].vel - 100)).toBeLessThanOrEqual(1)
  })

  it('keeps track name', () => {
    const back = midiToDoc(docToMidi(doc))
    expect(back.tracks[0].name).toBe('Lead')
  })
})
