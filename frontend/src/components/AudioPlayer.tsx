import { useRef, useState, useEffect } from 'react'
import { Play, Pause, Volume2, VolumeX } from 'lucide-react'

interface Props {
  src: string
  title?: string
}

function fmt(secs: number) {
  if (!isFinite(secs)) return '--:--'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AudioPlayer({ src, title }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => setCurrentTime(el.currentTime)
    const onMeta = () => setDuration(el.duration)
    const onEnded = () => setPlaying(false)
    el.addEventListener('timeupdate', onTime)
    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('ended', onEnded)
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.removeEventListener('loadedmetadata', onMeta)
      el.removeEventListener('ended', onEnded)
    }
  }, [])

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current
    if (!el) return
    el.currentTime = Number(e.target.value)
    setCurrentTime(Number(e.target.value))
  }

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value)
    setVolume(v)
    if (audioRef.current) audioRef.current.volume = v
    setMuted(v === 0)
  }

  const toggleMute = () => {
    const el = audioRef.current
    if (!el) return
    el.muted = !muted
    setMuted(!muted)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="bg-bg-3 rounded-lg px-3 py-2.5 flex flex-col gap-2">
      <audio ref={audioRef} src={src} preload="metadata" />

      {title && <p className="text-xs text-text-2 truncate">{title}</p>}

      {/* Seek bar */}
      <div className="relative h-1.5 bg-bg-4 rounded-full cursor-pointer group">
        <div
          className="absolute inset-y-0 left-0 bg-accent rounded-full pointer-events-none"
          style={{ width: `${progress}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={seek}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggle}
          className="shrink-0 w-7 h-7 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center transition-colors"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause size={13} fill="currentColor" className="text-white" /> : <Play size={13} fill="currentColor" className="text-white ml-0.5" />}
        </button>

        <span className="text-[10px] text-text-3 tabular-nums shrink-0">
          {fmt(currentTime)} / {fmt(duration)}
        </span>

        <div className="flex items-center gap-1 ml-auto shrink-0">
          <button onClick={toggleMute} className="text-text-3 hover:text-text-1 transition-colors">
            {muted || volume === 0 ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
          <div className="relative w-16 h-1.5 bg-bg-4 rounded-full">
            <div
              className="absolute inset-y-0 left-0 bg-bg-3 rounded-full pointer-events-none"
              style={{ width: `${(muted ? 0 : volume) * 100}%` }}
            />
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={changeVolume}
              className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
