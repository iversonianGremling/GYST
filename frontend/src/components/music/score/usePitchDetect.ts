// Phase 4 — pitch detection for the "sing to notes" feature. Monophonic only.
// Offline (analyse a recorded clip) and live (stream from the mic) both reduce
// to: per-frame f0 → MIDI → median-smooth → segment into notes.
import { PitchDetector } from 'pitchy'

export interface PitchFrame {
  t: number // seconds
  midi: number | null // null = unvoiced/silence
}

export interface DetectedNote {
  midi: number
  startSec: number
  durSec: number
}

const WIN = 2048
const HOP = 1024
const CLARITY = 0.9
const MIN_HZ = 55
const MAX_HZ = 1600

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440)
}

/** Median filter over the voiced MIDI values to tame octave/jitter errors. */
export function smoothFrames(frames: PitchFrame[], radius = 1): PitchFrame[] {
  return frames.map((f, i) => {
    if (f.midi == null) return f
    const window: number[] = []
    for (let j = i - radius; j <= i + radius; j++) {
      const m = frames[j]?.midi
      if (m != null) window.push(m)
    }
    window.sort((a, b) => a - b)
    return { t: f.t, midi: window[Math.floor(window.length / 2)] }
  })
}

/** Merge consecutive same-pitch voiced frames into notes. */
export function segmentFrames(frames: PitchFrame[], minDurSec = 0.09): DetectedNote[] {
  const notes: DetectedNote[] = []
  let cur: { midi: number; start: number; last: number } | null = null
  const push = () => {
    if (!cur) return
    const dur = cur.last - cur.start
    if (dur >= minDurSec) notes.push({ midi: cur.midi, startSec: cur.start, durSec: dur })
    cur = null
  }
  for (const f of frames) {
    const m = f.midi == null ? null : Math.round(f.midi)
    if (m == null) {
      push()
      continue
    }
    if (!cur) cur = { midi: m, start: f.t, last: f.t }
    else if (m === cur.midi) cur.last = f.t
    else {
      push()
      cur = { midi: m, start: f.t, last: f.t }
    }
  }
  push()
  return notes
}

function frameMidi(detector: PitchDetector<Float32Array>, buf: Float32Array, sr: number): number | null {
  const [hz, clarity] = detector.findPitch(buf, sr)
  if (clarity < CLARITY || hz < MIN_HZ || hz > MAX_HZ) return null
  return hzToMidi(hz)
}

/** Offline analysis of a decoded clip → notes. */
export function analyzeBuffer(buffer: AudioBuffer, minDurSec = 0.09): DetectedNote[] {
  const data = buffer.getChannelData(0)
  const sr = buffer.sampleRate
  const detector = PitchDetector.forFloat32Array(WIN)
  const slice = new Float32Array(WIN)
  const frames: PitchFrame[] = []
  for (let i = 0; i + WIN <= data.length; i += HOP) {
    slice.set(data.subarray(i, i + WIN))
    frames.push({ t: i / sr, midi: frameMidi(detector, slice, sr) })
  }
  return segmentFrames(smoothFrames(frames), minDurSec)
}

/** Live mic tracker. Emits a DetectedNote each time a sung note ends. */
export class LivePitchTracker {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private analyser: AnalyserNode | null = null
  private detector: PitchDetector<Float32Array> | null = null
  private buf = new Float32Array(WIN)
  private raf = 0
  private t0 = 0
  private cur: { midi: number; start: number; last: number } | null = null
  private recent: number[] = []

  constructor(
    private onNote: (n: DetectedNote) => void,
    private onLevel?: (midi: number | null, clarity: number) => void,
    private minDurSec = 0.09,
  ) {}

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
    this.ctx = new Ctx()
    const src = this.ctx.createMediaStreamSource(this.stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = WIN
    src.connect(this.analyser)
    this.detector = PitchDetector.forFloat32Array(WIN)
    this.t0 = this.ctx.currentTime
    this.loop()
  }

  private loop = (): void => {
    if (!this.analyser || !this.ctx || !this.detector) return
    this.analyser.getFloatTimeDomainData(this.buf)
    const [hz, clarity] = this.detector.findPitch(this.buf, this.ctx.sampleRate)
    const voiced = clarity >= CLARITY && hz >= MIN_HZ && hz <= MAX_HZ
    const t = this.ctx.currentTime - this.t0

    // 3-frame median for stability
    let midi: number | null = null
    if (voiced) {
      this.recent.push(Math.round(hzToMidi(hz)))
      if (this.recent.length > 3) this.recent.shift()
      const s = [...this.recent].sort((a, b) => a - b)
      midi = s[Math.floor(s.length / 2)]
    } else {
      this.recent = []
    }
    this.onLevel?.(midi, clarity)

    if (midi == null) {
      this.close(t)
    } else if (!this.cur) {
      this.cur = { midi, start: t, last: t }
    } else if (midi === this.cur.midi) {
      this.cur.last = t
    } else {
      this.close(t)
      this.cur = { midi, start: t, last: t }
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private close(t: number): void {
    if (!this.cur) return
    const dur = (this.cur.last || t) - this.cur.start
    if (dur >= this.minDurSec) this.onNote({ midi: this.cur.midi, startSec: this.cur.start, durSec: dur })
    this.cur = null
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.close(this.ctx ? this.ctx.currentTime - this.t0 : 0)
    this.stream?.getTracks().forEach((tr) => tr.stop())
    void this.ctx?.close()
    this.ctx = null
    this.analyser = null
    this.detector = null
    this.recent = []
  }
}
