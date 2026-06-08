import { describe, it, expect } from 'vitest'
import {
  midiToName,
  nameToMidi,
  isBlackKey,
  quantize,
  snapDown,
  gridTicks,
  ticksPerBar,
  fretToPitch,
  pitchToFret,
  ticksToSeconds,
  secondsToTicks,
  ceilToBar,
  buildArrangementDoc,
  type ScoreDoc,
  type ArrangementDoc,
} from '../types'

describe('pitch names', () => {
  it('round-trips middle C', () => {
    expect(midiToName(60)).toBe('C4')
    expect(nameToMidi('C4')).toBe(60)
  })
  it('handles sharps and octaves', () => {
    expect(midiToName(61)).toBe('C#4')
    expect(nameToMidi('A0')).toBe(21)
    expect(nameToMidi('G#5')).toBe(80)
  })
  it('round-trips a range', () => {
    for (let m = 21; m <= 108; m++) expect(nameToMidi(midiToName(m))).toBe(m)
  })
  it('identifies black keys', () => {
    expect(isBlackKey(61)).toBe(true) // C#
    expect(isBlackKey(60)).toBe(false) // C
  })
})

describe('quantize', () => {
  it('snaps to nearest grid', () => {
    expect(quantize(130, 120)).toBe(120)
    expect(quantize(190, 120)).toBe(240)
  })
  it('snapDown floors', () => {
    expect(snapDown(239, 120)).toBe(120)
    expect(snapDown(240, 120)).toBe(240)
  })
})

describe('grid / bars', () => {
  it('computes division ticks', () => {
    expect(gridTicks(4, 480)).toBe(480) // quarter
    expect(gridTicks(16, 480)).toBe(120) // sixteenth
  })
  it('computes bar length', () => {
    expect(ticksPerBar([4, 4], 480)).toBe(1920)
    expect(ticksPerBar([3, 4], 480)).toBe(1440)
    expect(ticksPerBar([6, 8], 480)).toBe(1440)
  })
})

describe('tab tuning', () => {
  const tuning = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']
  it('maps fret to pitch', () => {
    expect(fretToPitch(0, 0, tuning)).toBe(nameToMidi('E2'))
    expect(fretToPitch(0, 3, tuning)).toBe(nameToMidi('G2'))
    expect(fretToPitch(5, 0, tuning)).toBe(nameToMidi('E4'))
  })
  it('inverts pitchToFret', () => {
    const p = fretToPitch(2, 5, tuning)
    expect(pitchToFret(p, 2, tuning)).toBe(5)
  })
})

describe('timing', () => {
  it('converts ticks to seconds at 120bpm', () => {
    // a quarter note at 120bpm = 0.5s
    expect(ticksToSeconds(480, 120, 480)).toBeCloseTo(0.5)
    expect(secondsToTicks(0.5, 120, 480)).toBeCloseTo(480)
  })
})

describe('arrangement', () => {
  it('ceilToBar rounds up to whole bars', () => {
    expect(ceilToBar(1, [4, 4], 480)).toBe(1920) // min one bar
    expect(ceilToBar(1920, [4, 4], 480)).toBe(1920)
    expect(ceilToBar(2000, [4, 4], 480)).toBe(3840)
  })

  it('repeats a clip source to fill its length and truncates overflow', () => {
    const src: ScoreDoc = {
      v: 1, ppq: 480, tempo: 120, timeSig: [4, 4],
      tracks: [{ id: 't', name: 'a', kind: 'midi', instrument: 'synth', notes: [
        { id: 'n', pitch: 60, start: 0, dur: 480, vel: 100 },
      ] }],
    }
    const arr: ArrangementDoc = {
      v: 1, ppq: 480, tempo: 120, timeSig: [4, 4], lanes: 2,
      clips: [{ id: 'c', scoreId: 's1', name: 'c', lane: 0, startTick: 1920, lengthTick: 3840 }],
    }
    const out = buildArrangementDoc(arr, { s1: src })
    const notes = out.tracks[0].notes
    // source is one bar long → repeats twice across a 2-bar clip starting at bar 2
    expect(notes).toHaveLength(2)
    expect(notes.map((n) => n.start).sort((a, b) => a - b)).toEqual([1920, 3840])
  })
})
