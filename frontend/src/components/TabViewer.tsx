import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Square, ChevronUp, ChevronDown } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AT = any

interface Props {
  src: string
  title?: string
}

export default function TabViewer({ src, title }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const apiRef       = useRef<AT>(null)

  const [ready,       setReady]       = useState(false)
  const [playing,     setPlaying]     = useState(false)
  const [tempo,       setTempo]       = useState(120)
  const [speed,       setSpeed]       = useState(1)
  const [tracks,      setTracks]      = useState<{ index: number; name: string }[]>([])
  const [error,       setError]       = useState<string | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let api: AT = null

    // Dynamic import avoids SSR issues and lets Vite skip the module during
    // initial parse. alphaTab is excluded from optimizeDeps.
    import('@coderline/alphatab').then((at) => {
      // Cast to any — alphaTab's TS types don't expose all runtime settings
      const settings: AT = {
        core: {
          fontDirectory: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.2/dist/font/',
          workerScript: '/alphaTab.worker.mjs',
        },
        display: {
          layoutMode: at.LayoutMode.Page,
          staveProfile: at.StaveProfile.TabMixed,
        },
        player: {
          enablePlayer: true,
          enableCursor: true,
          soundFont: 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.2/dist/soundfont/sonivox.sf2',
        },
      }
      api = new at.AlphaTabApi(el, settings)

      api.scoreLoaded.on((score: AT) => {
        setTracks(score.tracks.map((tr: AT, i: number) => ({ index: i, name: tr.name || `Track ${i + 1}` })))
        setTempo(Math.round(score.tempo))
        setReady(true)
      })
      api.playerStateChanged.on((args: AT) => setPlaying(args.state === 1))
      api.error.on((err: Error) => setError(err?.message ?? 'Failed to load tab'))

      apiRef.current = api
      api.load(src)
    }).catch((e) => setError(String(e)))

    return () => { api?.destroy(); apiRef.current = null }
  }, [src])

  const togglePlay = () => {
    if (!apiRef.current) return
    playing ? apiRef.current.pause() : apiRef.current.playPause()
  }

  const stop = () => { apiRef.current?.stop(); setPlaying(false) }

  const changeSpeed = (delta: number) => {
    const next = Math.max(0.25, Math.min(2, Math.round((speed + delta) * 4) / 4))
    setSpeed(next)
    if (apiRef.current) apiRef.current.playbackSpeed = next
  }

  const selectTrack = (idx: number) => {
    if (!apiRef.current?.score) return
    apiRef.current.renderTracks([apiRef.current.score.tracks[idx]])
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap bg-bg-2 rounded-lg px-3 py-2 border border-bg-3">
        {title && <span className="text-xs text-text-2 truncate flex-1 min-w-0">{title}</span>}

        {!ready && !error && (
          <span className="text-xs text-text-3 animate-pulse">Loading score…</span>
        )}
        {error && <span className="text-xs text-danger truncate">{error}</span>}

        {ready && (
          <>
            {tracks.length > 1 && (
              <select className="input text-xs py-1 h-auto" onChange={(e) => selectTrack(Number(e.target.value))}>
                {tracks.map((t) => <option key={t.index} value={t.index}>{t.name}</option>)}
              </select>
            )}

            <span className="text-xs text-text-3 tabular-nums shrink-0">{tempo} BPM</span>

            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => changeSpeed(-0.25)} className="text-text-3 hover:text-text-1"><ChevronDown size={13} /></button>
              <span className="text-xs text-text-2 w-7 text-center tabular-nums">{speed}×</span>
              <button onClick={() => changeSpeed(+0.25)} className="text-text-3 hover:text-text-1"><ChevronUp size={13} /></button>
            </div>

            <button
              onClick={togglePlay}
              className="w-7 h-7 rounded-full bg-accent hover:bg-accent-hover flex items-center justify-center transition-colors shrink-0"
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing
                ? <Pause size={12} fill="currentColor" className="text-white" />
                : <Play  size={12} fill="currentColor" className="text-white ml-0.5" />}
            </button>
            <button onClick={stop} className="text-text-3 hover:text-text-1 shrink-0" aria-label="Stop">
              <Square size={13} />
            </button>
          </>
        )}
      </div>

      {/* alphaTab render surface — white background required by the library */}
      <div
        ref={containerRef}
        className="rounded-lg overflow-auto border border-bg-3 bg-white"
        style={{ minHeight: 200, maxHeight: '60vh' }}
      />
    </div>
  )
}
