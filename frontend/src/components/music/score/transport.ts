// Playback engine: schedules a ScoreDoc onto Tone.js and reports the playhead.
// One ScorePlayer drives one editor instance. Uses Tone.Part per track.
import * as Tone from 'tone'
import { ScoreDoc, midiToName, ticksToSeconds } from './types'
import { makeSynth } from './synth'

interface PartEvent {
  time: number
  note: string
  dur: number
  vel: number
}

export class ScorePlayer {
  private synths: Array<{ dispose: () => void }> = []
  private parts: Tone.Part[] = []
  private onTick?: (sec: number) => void
  private onEnd?: () => void
  private raf = 0
  private startSec = 0
  private endSec = 0
  private looping = false
  private _playing = false

  get playing(): boolean {
    return this._playing
  }

  setOnTick(cb: (sec: number) => void): void {
    this.onTick = cb
  }

  setOnEnd(cb: () => void): void {
    this.onEnd = cb
  }

  /** Audition a single pitch through a fresh synth (used by piano keys / step input). */
  static async preview(instrument: string, pitch: number, durSec = 0.4, vel = 0.8): Promise<void> {
    await Tone.start()
    const synth = makeSynth(instrument)
    synth.triggerAttackRelease(midiToName(pitch), durSec, undefined, vel)
    setTimeout(() => synth.dispose(), durSec * 1000 + 600)
  }

  async play(
    doc: ScoreDoc,
    fromTick = 0,
    opts: { metronome?: boolean; countInBeats?: number; loop?: { startTick: number; endTick: number } } = {},
  ): Promise<void> {
    await Tone.start()
    this.stop()
    Tone.Transport.bpm.value = doc.tempo

    const secPerBeat = 60 / doc.tempo
    const countInSec = (opts.countInBeats ?? 0) * secPerBeat

    let end = 0
    for (const track of doc.tracks) {
      const synth = makeSynth(track.instrument)
      this.synths.push(synth)
      const events: PartEvent[] = []
      for (const n of track.notes) {
        if (n.start + n.dur <= fromTick) continue
        const startSec = ticksToSeconds(Math.max(0, n.start - fromTick), doc.tempo, doc.ppq)
        const durSec = ticksToSeconds(n.dur, doc.tempo, doc.ppq)
        events.push({ time: startSec + countInSec, note: midiToName(n.pitch), dur: durSec, vel: n.vel / 127 })
        end = Math.max(end, startSec + durSec)
      }
      const part = new Tone.Part((time, ev) => {
        const e = ev as PartEvent
        synth.triggerAttackRelease(e.note, e.dur, time, e.vel)
      }, events as unknown[])
      part.start(0)
      this.parts.push(part)
    }

    // metronome / count-in clicks
    if (opts.metronome || countInSec > 0) {
      const click = new Tone.MembraneSynth({ pitchDecay: 0.008, octaves: 2 }).toDestination()
      click.volume.value = -8
      this.synths.push(click)
      const beatsPerBar = doc.timeSig[0]
      const totalSec = countInSec + end
      const clickEvents: { time: number; accent: boolean }[] = []
      for (let t = 0, b = 0; t <= totalSec + 1e-6; t += secPerBeat, b++) {
        const inCountIn = t < countInSec - 1e-6
        if (inCountIn || opts.metronome) {
          clickEvents.push({ time: t, accent: b % beatsPerBar === 0 })
        }
      }
      const cpart = new Tone.Part((time, ev) => {
        const e = ev as { accent: boolean }
        click.triggerAttackRelease(e.accent ? 'C3' : 'C2', 0.03, time)
      }, clickEvents as unknown[])
      cpart.start(0)
      this.parts.push(cpart)
    }

    // loop region (transport-relative seconds, after the count-in offset)
    this.looping = false
    if (opts.loop && opts.loop.endTick > opts.loop.startTick) {
      this.looping = true
      Tone.Transport.loop = true
      Tone.Transport.loopStart = countInSec + ticksToSeconds(opts.loop.startTick - fromTick, doc.tempo, doc.ppq)
      Tone.Transport.loopEnd = countInSec + ticksToSeconds(opts.loop.endTick - fromTick, doc.tempo, doc.ppq)
    } else {
      Tone.Transport.loop = false
    }

    // playhead reads song-time; during count-in it sits before the downbeat
    this.startSec = ticksToSeconds(fromTick, doc.tempo, doc.ppq) - countInSec
    this.endSec = end
    Tone.Transport.position = 0
    Tone.Transport.start()
    this._playing = true
    this.loop()
  }

  private loop = (): void => {
    if (!this._playing) return
    const sec = this.startSec + Tone.Transport.seconds
    this.onTick?.(sec)
    if (!this.looping && this.endSec > 0 && sec >= this.endSec + 0.1) {
      this.stop()
      this.onEnd?.()
      return
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  stop(): void {
    this._playing = false
    this.looping = false
    cancelAnimationFrame(this.raf)
    Tone.Transport.stop()
    Tone.Transport.loop = false
    Tone.Transport.cancel()
    for (const p of this.parts) p.dispose()
    this.parts = []
    for (const s of this.synths) s.dispose()
    this.synths = []
  }

  dispose(): void {
    this.stop()
  }
}
