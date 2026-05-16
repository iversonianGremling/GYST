import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, Save, Link2, Columns2, Pin, PinOff } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type Note as NoteType, type MediaAsset } from '@/api/client'
import { resolveWikilinks } from '@/lib/wikilinks'
import CoverHero, { DEFAULT_COVER_SETTINGS, type CoverSettings } from '@/components/CoverHero'

type ViewMode = 'edit' | 'preview' | 'split'

const SPLIT_MIN = 15
const SPLIT_MAX = 85

export default function NoteEditor() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const isNew = id === 'new'

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [description, setDescription] = useState('')
  const [pinned, setPinned] = useState(false)
  const [coverUrl, setCoverUrl] = useState<string | null>(null)
  const [coverSettings, setCoverSettings] = useState<CoverSettings>(DEFAULT_COVER_SETTINGS)
  const [coverDirty, setCoverDirty] = useState(false)
  const [mode, setMode] = useState<ViewMode>('split')
  const [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [splitRatio, setSplitRatio] = useState(50)

  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  useEffect(() => {
    if (isNew) return
    api.get<NoteType>(`/notes/${id}`).then((n) => {
      setTitle(n.title)
      setBody(n.body_md)
      setDescription(n.description ?? '')
      setPinned(n.pinned)
      setCoverUrl(n.cover_path)
      setCoverSettings(n.cover_settings ?? DEFAULT_COVER_SETTINGS)
    })
    api.get<{ id: string; title: string }[]>(`/notes/${id}/backlinks`).then(setBacklinks)
  }, [id, isNew])

  const save = useCallback(async () => {
    setSaving(true)
    try {
      if (isNew) {
        const created = await api.post<NoteType>('/notes', {
          title,
          body_md: body,
          description: description || null,
          pinned,
          interest_id: searchParams.get('interest_id') || null,
        })
        navigate(`/notes/${created.id}`, { replace: true })
      } else {
        const patch: Record<string, unknown> = { title, body_md: body, description: description || null, pinned }
        if (coverDirty) {
          patch.cover_settings = coverSettings
        }
        await api.patch(`/notes/${id}`, patch)
        setCoverDirty(false)
      }
    } finally {
      setSaving(false)
    }
  }, [id, isNew, title, body, description, pinned, coverSettings, coverDirty, navigate, searchParams])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save])

  const uploadCover = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    if (id && !isNew) form.append('note_id', id)
    const asset = await api.upload<MediaAsset>('/media', form)
    setCoverUrl(asset.url)
    if (!isNew && id) {
      await api.patch(`/notes/${id}`, { cover_path: asset.url })
    }
  }

  const togglePin = async () => {
    const next = !pinned
    setPinned(next)
    if (!isNew && id) {
      await api.patch(`/notes/${id}`, { pinned: next })
    }
  }

  // ── Draggable separator ──────────────────────────────────────────────────
  const applyDrag = useCallback((clientY: number) => {
    const el = containerRef.current
    if (!el) return
    const { top, height } = el.getBoundingClientRect()
    const pct = ((clientY - top) / height) * 100
    setSplitRatio(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, pct)))
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => { if (dragging.current) applyDrag(ev.clientY) }
    const onUp = () => {
      dragging.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [applyDrag])

  const onTouchStart = useCallback((_e: React.TouchEvent) => {
    dragging.current = true
    const onMove = (ev: TouchEvent) => {
      if (!dragging.current) return
      ev.preventDefault()
      applyDrag(ev.touches[0].clientY)
    }
    const onEnd = () => {
      dragging.current = false
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
    }
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd)
  }, [applyDrag])
  // ────────────────────────────────────────────────────────────────────────

  const previewBody = resolveWikilinks(body, (t) => `/notes?q=${encodeURIComponent(t)}`)

  const preview = (
    <div className="h-full overflow-y-auto p-5 prose prose-sm prose-invert max-w-none
                    prose-headings:text-text-1 prose-p:text-text-2 prose-a:text-accent
                    prose-code:text-accent prose-code:bg-bg-3 prose-code:px-1 prose-code:rounded
                    prose-pre:bg-bg-3 prose-pre:border prose-pre:border-bg-4
                    prose-blockquote:border-accent prose-blockquote:text-text-3">
      {body
        ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{previewBody}</ReactMarkdown>
        : <p className="text-text-3 italic">Nothing to preview yet…</p>
      }
    </div>
  )

  const editor = (
    <textarea
      className="w-full h-full bg-bg-1 text-text-1 font-mono text-sm p-5 resize-none focus:outline-none leading-relaxed"
      placeholder="Write in Markdown… use [[wikilinks]] to link notes."
      value={body}
      onChange={(e) => setBody(e.target.value)}
    />
  )

  return (
    <div className="flex flex-col h-full">
      {/* Cover hero — only when not new and we have a title */}
      {!isNew && title && (
        <div className="shrink-0">
          <CoverHero
            title={title}
            coverUrl={coverUrl}
            settings={coverSettings}
            editable
            onUpload={uploadCover}
            onSettingsChange={(s) => { setCoverSettings(s); setCoverDirty(true) }}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-bg-3 bg-bg-2 shrink-0">
        <input
          className="flex-1 bg-transparent text-base font-semibold text-text-1 focus:outline-none placeholder:text-text-3 min-w-0"
          placeholder="Note title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* Description (compact) */}
        <input
          className="w-48 bg-transparent text-xs text-text-3 focus:outline-none placeholder:text-text-3 border-l border-bg-3 pl-3 py-0.5 focus:text-text-2"
          placeholder="Description…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {/* Pin toggle */}
        <button
          onClick={togglePin}
          title={pinned ? 'Unpin' : 'Pin'}
          className={`p-1.5 rounded transition-colors ${pinned ? 'text-accent' : 'text-text-3 hover:text-text-1 hover:bg-bg-3'}`}
        >
          {pinned ? <Pin size={14} /> : <PinOff size={14} />}
        </button>

        {/* View mode toggles */}
        <div className="flex items-center gap-0.5 bg-bg-3 rounded-md p-0.5 shrink-0">
          <button
            title="Edit only"
            onClick={() => setMode('edit')}
            className={`p-1.5 rounded transition-colors ${mode === 'edit' ? 'bg-bg-4 text-text-1' : 'text-text-2 hover:text-text-1 hover:bg-bg-4'}`}
          >
            <EyeOff size={14} />
          </button>
          <button
            title="Split view"
            onClick={() => setMode('split')}
            className={`p-1.5 rounded transition-colors ${mode === 'split' ? 'bg-bg-4 text-text-1' : 'text-text-2 hover:text-text-1 hover:bg-bg-4'}`}
          >
            <Columns2 size={14} style={{ transform: 'rotate(90deg)' }} />
          </button>
          <button
            title="Preview only"
            onClick={() => setMode('preview')}
            className={`p-1.5 rounded transition-colors ${mode === 'preview' ? 'bg-bg-4 text-text-1' : 'text-text-2 hover:text-text-1 hover:bg-bg-4'}`}
          >
            <Eye size={14} />
          </button>
        </div>

        <button
          className="btn-primary text-xs flex items-center gap-1.5 shrink-0"
          onClick={save}
          disabled={saving}
        >
          <Save size={13} />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-h-0 min-w-0">
          {mode === 'edit' && <div className="flex-1 min-h-0">{editor}</div>}
          {mode === 'preview' && <div className="flex-1 min-h-0 bg-bg-2">{preview}</div>}
          {mode === 'split' && (
            <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
              <div style={{ height: `${splitRatio}%` }} className="min-h-0 overflow-hidden">
                {editor}
              </div>
              <div
                className="shrink-0 h-1.5 bg-bg-3 hover:bg-accent/40 active:bg-accent/60 cursor-row-resize transition-colors touch-none flex items-center justify-center group"
                onMouseDown={onMouseDown}
                onTouchStart={onTouchStart}
              >
                <div className="w-8 h-0.5 rounded-full bg-bg-4 group-hover:bg-accent/60 transition-colors" />
              </div>
              <div style={{ height: `${100 - splitRatio}%` }} className="min-h-0 overflow-hidden bg-bg-2">
                {preview}
              </div>
            </div>
          )}
        </div>

        {/* Backlinks panel */}
        {!isNew && backlinks.length > 0 && (
          <aside className="w-48 shrink-0 border-l border-bg-3 bg-bg-2 p-3 overflow-y-auto">
            <p className="text-xs text-text-3 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Link2 size={11} /> Backlinks
            </p>
            <div className="space-y-1">
              {backlinks.map((b) => (
                <a key={b.id} href={`/notes/${b.id}`} className="block text-xs text-accent hover:underline truncate">
                  {b.title}
                </a>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
