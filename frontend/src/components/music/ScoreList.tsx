// Lists a project's scores; opens one in the ScoreEditor. New/blank scores are
// seeded server-side from the project's bpm/time-signature; .mid import creates
// a score from an uploaded file.
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Music4, Guitar, Trash2, Upload, Pencil, ListMusic, LayoutGrid } from 'lucide-react'
import { api } from '@/api/client'
import { ScoreDoc } from './score/types'
import { midiToDoc } from './score/midiIo'
import ScoreEditor from './ScoreEditor'
import ArrangeView from './ArrangeView'

interface ScoreMeta {
  id: string
  name: string
  kind: 'midi' | 'tab'
  updated_at: string
}
interface FullScore extends ScoreMeta {
  doc: ScoreDoc
}

export default function ScoreList({ interestId }: { interestId: string }) {
  const [scores, setScores] = useState<ScoreMeta[]>([])
  const [open, setOpen] = useState<FullScore | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'scores' | 'arrange'>('scores')
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    api
      .get<ScoreMeta[]>(`/plugins/music-project/scores/${interestId}`)
      .then((s) => setScores(s))
      .finally(() => setLoading(false))
  }, [interestId])

  useEffect(() => {
    load()
  }, [load])

  // Prevent the page behind the full-screen editor from scrolling.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  const create = async (kind: 'midi' | 'tab') => {
    const s = await api.post<FullScore>(`/plugins/music-project/scores/${interestId}`, {
      name: kind === 'tab' ? 'Untitled tab' : 'Untitled',
      kind,
    })
    setOpen(s)
  }

  const openScore = async (id: string) => {
    const s = await api.get<FullScore>(`/plugins/music-project/score/${id}`)
    setOpen(s)
  }

  const rename = async (s: ScoreMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    const name = window.prompt('Rename score', s.name)
    if (!name) return
    await api.put(`/plugins/music-project/score/${s.id}`, { name })
    load()
  }

  const del = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!window.confirm('Delete this score?')) return
    await api.del(`/plugins/music-project/score/${id}`)
    load()
  }

  const onImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const doc = midiToDoc(await f.arrayBuffer())
    const s = await api.post<FullScore>(`/plugins/music-project/scores/${interestId}`, {
      name: f.name.replace(/\.midi?$/i, ''),
      kind: 'midi',
      doc,
    })
    e.target.value = ''
    setOpen(s)
  }

  if (open) {
    // Take over the full viewport so the editor isn't squeezed under the page
    // chrome (cover hero, tabs, sub-tabs). Portalled to <body> to escape the
    // scrolling main container.
    return createPortal(
      <div data-fullscreen-editor className="fixed inset-0 z-50 bg-bg-1 overflow-y-auto overscroll-contain">
        <ScoreEditor
          scoreId={open.id}
          initialDoc={open.doc}
          name={open.name}
          interestId={interestId}
          fullscreen
          onBack={() => {
            setOpen(null)
            load()
          }}
        />
      </div>,
      document.body,
    )
  }

  if (view === 'arrange') {
    return (
      <div className="space-y-3">
        <div className="flex gap-0.5">
          <button
            className="btn-ghost text-xs flex items-center gap-1.5 py-1"
            onClick={() => setView('scores')}
          >
            <ListMusic size={13} /> Scores
          </button>
          <button className="btn-ghost text-xs flex items-center gap-1.5 py-1 text-accent">
            <LayoutGrid size={13} /> Arrange
          </button>
        </div>
        <ArrangeView interestId={interestId} onBack={() => setView('scores')} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-0.5">
        <button className="btn-ghost text-xs flex items-center gap-1.5 py-1 text-accent">
          <ListMusic size={13} /> Scores
        </button>
        <button
          className="btn-ghost text-xs flex items-center gap-1.5 py-1"
          onClick={() => setView('arrange')}
        >
          <LayoutGrid size={13} /> Arrange
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button className="btn-primary text-xs flex items-center gap-1.5" onClick={() => create('midi')}>
          <Plus size={13} /> New score
        </button>
        <button className="btn-ghost text-xs flex items-center gap-1.5" onClick={() => create('tab')}>
          <Guitar size={13} /> New tab
        </button>
        <button
          className="btn-ghost text-xs flex items-center gap-1.5"
          onClick={() => fileRef.current?.click()}
        >
          <Upload size={13} /> Import .mid
        </button>
        <input ref={fileRef} type="file" accept=".mid,.midi" hidden onChange={onImport} />
      </div>

      {loading ? (
        <p className="text-sm text-text-3">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-sm text-text-3 italic">
          No scores yet — create one to start writing a melody in the piano roll.
        </p>
      ) : (
        <div className="space-y-1.5">
          {scores.map((s) => (
            <div
              key={s.id}
              onClick={() => openScore(s.id)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-bg-3 hover:border-accent/50 cursor-pointer group"
            >
              {s.kind === 'tab' ? (
                <Guitar size={14} className="text-accent shrink-0" />
              ) : (
                <Music4 size={14} className="text-accent shrink-0" />
              )}
              <span className="text-sm text-text-1 flex-1 truncate">{s.name}</span>
              <span className="text-[10px] uppercase tracking-wide text-text-3">{s.kind}</span>
              <button
                className="text-text-3 hover:text-text-1 opacity-0 group-hover:opacity-100"
                onClick={(e) => rename(s, e)}
                title="Rename"
              >
                <Pencil size={13} />
              </button>
              <button
                className="text-text-3 hover:text-danger opacity-0 group-hover:opacity-100"
                onClick={(e) => del(s.id, e)}
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
