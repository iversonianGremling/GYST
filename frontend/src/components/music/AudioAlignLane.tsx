// Phase 2 — link a score to an audio recording. Renders the chosen asset's
// waveform on the SAME pixel/time axis as the piano roll (pxPerSec derived from
// pxPerTick + tempo), lets you drag it to set audioLink.offsetMs, and plays the
// audio in sync with the Tone.js score so you can align by ear/eye.
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import WaveSurfer from 'wavesurfer.js'
import { Link2Off } from 'lucide-react'
import { api, type MediaAsset } from '@/api/client'
import { ScoreDoc } from './score/types'
import type { ScoreEditorApi } from './score/useScoreEditor'

export interface AudioLaneHandle {
  play: () => void
  stop: () => void
}

interface Props {
  interestId: string
  doc: ScoreDoc
  editor: ScoreEditorApi
  pxPerTick: number
  scrollLeft: number
  playheadTick: number | null
}

const LANE_H = 64

/** Pixels per second of audio at the current zoom/tempo (matches the grid). */
function pxPerSecond(doc: ScoreDoc, pxPerTick: number): number {
  const ticksPerSec = (doc.ppq * doc.tempo) / 60
  return pxPerTick * ticksPerSec
}

const AudioAlignLane = forwardRef<AudioLaneHandle, Props>(function AudioAlignLane(
  { interestId, doc, editor, pxPerTick, scrollLeft, playheadTick },
  ref,
) {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [ready, setReady] = useState(false)
  const waveBox = useRef<HTMLDivElement>(null)
  const ws = useRef<WaveSurfer | null>(null)
  const dragX = useRef<number | null>(null)

  const link = doc.audioLink
  const asset = link ? assets.find((a) => a.id === link.assetId) : undefined
  const pps = pxPerSecond(doc, pxPerTick)
  const offsetMs = link?.offsetMs ?? 0

  useEffect(() => {
    api
      .get<MediaAsset[]>(`/media?interest_id=${interestId}`)
      .then((m) => setAssets(m.filter((a) => a.kind === 'audio')))
      .catch(() => setAssets([]))
  }, [interestId])

  /* build / tear down the waveform when the linked asset changes */
  useEffect(() => {
    setReady(false)
    if (ws.current) {
      ws.current.destroy()
      ws.current = null
    }
    if (!asset || !waveBox.current) return
    const inst = WaveSurfer.create({
      container: waveBox.current,
      url: asset.url,
      height: LANE_H,
      waveColor: '#475569',
      progressColor: '#475569',
      cursorWidth: 0,
      minPxPerSec: pps,
      fillParent: false,
      autoScroll: false,
      interact: false,
      hideScrollbar: true,
      normalize: true,
    })
    inst.on('ready', () => setReady(true))
    ws.current = inst
    return () => {
      inst.destroy()
      if (ws.current === inst) ws.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, asset?.url])

  /* re-zoom when the grid zoom or tempo changes */
  useEffect(() => {
    if (ws.current && ready) {
      try {
        ws.current.zoom(pps)
      } catch {
        /* zoom before ready throws — ignored */
      }
    }
  }, [pps, ready])

  /* synced playback: at song t=0 the audio sits at offsetMs into itself */
  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const inst = ws.current
        if (!inst) return
        const seek = offsetMs / 1000
        if (seek >= 0) {
          inst.setTime(seek)
          void inst.play()
        } else {
          window.setTimeout(() => {
            inst.setTime(0)
            void inst.play()
          }, -offsetMs)
        }
      },
      stop: () => ws.current?.stop(),
    }),
    [offsetMs],
  )

  const setLink = useCallback(
    (assetId: string) => editor.commit((d) => ({ ...d, audioLink: { assetId, offsetMs: d.audioLink?.offsetMs ?? 0 } })),
    [editor],
  )
  const clearLink = useCallback(() => editor.commit((d) => ({ ...d, audioLink: undefined })), [editor])
  const nudge = useCallback(
    (ms: number) =>
      editor.commit((d) =>
        d.audioLink ? { ...d, audioLink: { ...d.audioLink, offsetMs: d.audioLink.offsetMs + ms } } : d,
      ),
    [editor],
  )

  /* drag the waveform horizontally to change the offset */
  const onPointerDown = (e: React.PointerEvent) => {
    if (!asset) return
    dragX.current = e.clientX
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragX.current == null || !link) return
    const dx = e.clientX - dragX.current
    if (Math.abs(dx) < 1) return
    dragX.current = e.clientX
    // dragging right moves the waveform later → offset decreases
    nudge((-dx / pps) * 1000)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    dragX.current = null
    ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
  }

  // content-x of audio start = -offsetPx; viewport x subtracts scrollLeft
  const offsetPx = (offsetMs / 1000) * pps
  const waveLeft = -(offsetPx + scrollLeft)
  const playheadX = playheadTick != null ? playheadTick * pxPerTick - scrollLeft : null

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text-3">Audio</span>
        <select
          className="input py-0.5 h-auto max-w-[12rem]"
          value={link?.assetId ?? ''}
          onChange={(e) => (e.target.value ? setLink(e.target.value) : clearLink())}
        >
          <option value="">— none —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.original_name}
            </option>
          ))}
        </select>
        {link && (
          <>
            <span className="text-text-3">offset</span>
            <button className="btn-ghost px-1.5 py-0.5" onClick={() => nudge(-50)}>
              −50ms
            </button>
            <span className="tabular-nums text-text-2 w-16 text-center">{Math.round(offsetMs)}ms</span>
            <button className="btn-ghost px-1.5 py-0.5" onClick={() => nudge(50)}>
              +50ms
            </button>
            <button className="text-text-3 hover:text-danger ml-1" onClick={clearLink} title="Unlink audio">
              <Link2Off size={13} />
            </button>
          </>
        )}
        {assets.length === 0 && (
          <span className="text-text-3 italic">Upload audio in the Samples tab to align it here.</span>
        )}
      </div>

      {link && (
        <div
          className="relative border border-bg-3 rounded-lg bg-[#0f172a] overflow-hidden"
          style={{ height: LANE_H, touchAction: 'none', cursor: 'ew-resize' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            ref={waveBox}
            style={{ position: 'absolute', top: 0, left: waveLeft, height: LANE_H }}
          />
          {!ready && (
            <span className="absolute inset-0 flex items-center justify-center text-xs text-text-3 animate-pulse">
              Loading waveform…
            </span>
          )}
          {playheadX != null && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: playheadX,
                width: 2,
                height: LANE_H,
                background: '#ef4444',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      )}
    </div>
  )
})

export default AudioAlignLane
