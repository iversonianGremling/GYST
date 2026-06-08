// Phase 3 — bind lyric syllables to notes. A strip under the piano roll with one
// cell per note (aligned to the same time axis); type a syllable and Enter/Tab
// jumps to the next note. "Pull from lyrics note" splits the project's lyrics
// note into syllables and assigns them in time order.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Type, Eraser } from 'lucide-react'
import { api } from '@/api/client'
import { ScoreDoc, docEndTick, ticksPerBar } from './score/types'
import type { ScoreEditorApi } from './score/useScoreEditor'

interface Props {
  interestId: string
  doc: ScoreDoc
  editor: ScoreEditorApi
  trackIndex: number
  pxPerTick: number
  scrollLeft: number
}

const LANE_H = 30

/** Rough word/syllable tokeniser: split on whitespace then on hyphens. */
function splitSyllables(text: string): string[] {
  return text
    .replace(/[\r\n]+/g, ' ')
    .split(/\s+/)
    .flatMap((w) => w.split('-'))
    .map((s) => s.replace(/[^\p{L}\p{N}'’]/gu, ''))
    .filter(Boolean)
}

export default function LyricLane({ interestId, doc, editor, trackIndex, pxPerTick, scrollLeft }: Props) {
  const track = doc.tracks[trackIndex]
  const notes = useMemo(
    () => [...track.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch),
    [track.notes],
  )
  const inputs = useRef<Map<string, HTMLInputElement>>(new Map())
  const [vals, setVals] = useState<Record<string, string>>({})

  const bar = ticksPerBar(doc.timeSig, doc.ppq)
  const totalTicks = Math.max(16 * bar, docEndTick(doc) + 4 * bar)
  const gridW = Math.ceil(totalTicks * pxPerTick)

  // re-sync local input values whenever committed lyrics change (pull / undo /
  // blur), but NOT on every keystroke (those don't commit, so the key is stable)
  const lyricKey = notes.map((n) => `${n.id}:${n.lyric ?? ''}`).join('|')
  useEffect(() => {
    const v: Record<string, string> = {}
    for (const n of notes) v[n.id] = n.lyric ?? ''
    setVals(v)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricKey])

  const commitLyric = useCallback(
    (id: string, value: string) => {
      const lyric = value.trim() || undefined
      editor.updateNote(id, { lyric }, trackIndex)
    },
    [editor, trackIndex],
  )

  const focusNext = (id: string) => {
    const i = notes.findIndex((n) => n.id === id)
    const next = notes[i + 1]
    if (next) inputs.current.get(next.id)?.focus()
  }

  const pull = async () => {
    const note = await api.get<{ body_md: string }>(`/plugins/music-project/lyrics/${interestId}`)
    const tokens = splitSyllables(note.body_md || '')
    editor.commit((d) => ({
      ...d,
      tracks: d.tracks.map((t, ti) =>
        ti !== trackIndex
          ? t
          : {
              ...t,
              notes: t.notes.map((n) => {
                const idx = notes.findIndex((x) => x.id === n.id)
                return { ...n, lyric: tokens[idx] || undefined }
              }),
            },
      ),
    }))
  }

  const clearAll = () =>
    editor.commit((d) => ({
      ...d,
      tracks: d.tracks.map((t, ti) =>
        ti !== trackIndex ? t : { ...t, notes: t.notes.map((n) => ({ ...n, lyric: undefined })) },
      ),
    }))

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-text-3 flex items-center gap-1">
          <Type size={12} /> Lyrics → notes
        </span>
        <button className="btn-ghost px-2 py-0.5" onClick={pull} title="Split the lyrics note into syllables">
          Pull from lyrics note
        </button>
        <button className="btn-ghost px-2 py-0.5 flex items-center gap-1" onClick={clearAll}>
          <Eraser size={12} /> Clear
        </button>
      </div>

      <div
        className="relative border border-bg-3 rounded-lg bg-bg-2 overflow-hidden"
        style={{ height: LANE_H }}
      >
        <div style={{ position: 'absolute', left: -scrollLeft, top: 0, width: gridW, height: '100%' }}>
          {notes.map((n) => {
            const left = n.start * pxPerTick
            const w = Math.max(28, n.dur * pxPerTick)
            return (
              <input
                key={n.id}
                ref={(el) => {
                  if (el) inputs.current.set(n.id, el)
                  else inputs.current.delete(n.id)
                }}
                value={vals[n.id] ?? ''}
                onChange={(e) => setVals((v) => ({ ...v, [n.id]: e.target.value }))}
                onBlur={(e) => commitLyric(n.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault()
                    commitLyric(n.id, (e.target as HTMLInputElement).value)
                    focusNext(n.id)
                  }
                }}
                placeholder="·"
                className="absolute top-1 h-[22px] text-[11px] text-center bg-bg-3/60 border border-bg-3 rounded text-text-1 focus:border-accent focus:outline-none"
                style={{ left, width: w - 2 }}
              />
            )
          })}
          {notes.length === 0 && (
            <span className="absolute left-2 top-1.5 text-[11px] text-text-3 italic">
              Add notes, then type syllables or pull from the lyrics note.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
