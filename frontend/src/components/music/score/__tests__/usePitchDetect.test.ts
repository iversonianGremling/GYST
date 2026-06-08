import { describe, it, expect } from 'vitest'
import { hzToMidi, segmentFrames, smoothFrames, type PitchFrame } from '../usePitchDetect'

describe('hzToMidi', () => {
  it('maps A4 and middle C', () => {
    expect(Math.round(hzToMidi(440))).toBe(69)
    expect(Math.round(hzToMidi(261.63))).toBe(60)
  })
})

describe('segmentFrames', () => {
  const frames = (vals: (number | null)[], dt = 0.05): PitchFrame[] =>
    vals.map((midi, i) => ({ t: i * dt, midi }))

  it('merges consecutive same-pitch frames into one note', () => {
    const notes = segmentFrames(frames([60, 60, 60, 60]))
    expect(notes).toHaveLength(1)
    expect(notes[0].midi).toBe(60)
    expect(notes[0].durSec).toBeGreaterThanOrEqual(0.1)
  })

  it('splits on pitch change and drops unvoiced gaps', () => {
    const notes = segmentFrames(frames([60, 60, 60, null, 67, 67, 67]))
    expect(notes.map((n) => n.midi)).toEqual([60, 67])
  })

  it('discards segments shorter than the minimum duration', () => {
    const notes = segmentFrames(frames([60, 64, 64, 64, 64]), 0.12)
    // the single 60 frame is too short; the run of 64 survives
    expect(notes.map((n) => n.midi)).toEqual([64])
  })
})

describe('smoothFrames', () => {
  it('median-filters an octave glitch', () => {
    const out = smoothFrames(frames3([60, 72, 60]))
    expect(out[1].midi).toBe(60)
  })
  function frames3(vals: number[]): PitchFrame[] {
    return vals.map((midi, i) => ({ t: i * 0.05, midi }))
  }
})
