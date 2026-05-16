import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Trash2, FileIcon, ImageIcon, Music2, FileText, Plus, Rss, Save } from 'lucide-react'
import { api, type Interest, type Note, type MediaAsset, type Project } from '@/api/client'
import { formatRelative } from '@/lib/utils'
import DropZone from '@/components/DropZone'
import AudioPlayer from '@/components/AudioPlayer'
import CoverHero, { type CoverSettings, DEFAULT_COVER_SETTINGS } from '@/components/CoverHero'
import { PluginSlot, usePluginSlotReady } from '@/plugins/slots'

interface FeedEntry { url: string; interest_id: string | null }

function KindIcon({ kind }: { kind: string }) {
  if (kind === 'audio') return <Music2 size={14} className="text-accent shrink-0" />
  if (kind === 'image') return <ImageIcon size={14} className="text-text-3 shrink-0" />
  if (kind === 'midi' || kind === 'tab') return <FileText size={14} className="text-text-3 shrink-0" />
  return <FileIcon size={14} className="text-text-3 shrink-0" />
}

type Tab = 'notes' | 'media' | 'project' | 'feeds' | 'settings'

export default function InterestDetail() {
  const { id } = useParams<{ id: string }>()
  const [interest, setInterest] = useState<Interest | null>(null)
  const [project,  setProject]  = useState<Project | null>(null)
  const [notes,    setNotes]    = useState<Note[]>([])
  const [media,    setMedia]    = useState<MediaAsset[]>([])
  const [tab,      setTab]      = useState<Tab>('notes')
  const [feeds,        setFeeds]        = useState<FeedEntry[]>([])
  const [newFeed,      setNewFeed]      = useState('')
  const [coverSettings, setCoverSettings] = useState<CoverSettings>(DEFAULT_COVER_SETTINGS)
  const [coverDirty,   setCoverDirty]   = useState(false)
  const [coverSaving,  setCoverSaving]  = useState(false)

  const { ready: pluginReady, count: pluginCount } = usePluginSlotReady('interest.project')

  const loadMedia = useCallback(() => {
    if (!id) return
    api.get<MediaAsset[]>(`/media?interest_id=${id}`).then(setMedia)
  }, [id])

  const loadFeeds = useCallback(() => {
    if (!id) return
    fetch(`/api/v1/plugins/rss-feed/feeds?interest_id=${id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setFeeds(d.feeds ?? []))
      .catch(() => {})
  }, [id])

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.get<Interest>(`/interests/${id}`),
      api.get<Note[]>(`/notes?interest_id=${id}`),
      api.get<MediaAsset[]>(`/media?interest_id=${id}`),
      api.get<Project>(`/projects/${id}`).catch(() => null),
    ]).then(([i, n, m, p]) => {
      setInterest(i); setNotes(n); setMedia(m); setProject(p)
      if (i?.cover_settings) setCoverSettings(i.cover_settings as CoverSettings)
    })
    loadFeeds()
  }, [id])

  const uploadCover = async (file: File) => {
    if (!id) return
    const form = new FormData()
    form.append('file', file)
    form.append('interest_id', id)
    const asset = await api.upload<MediaAsset>('/media', form)
    await api.patch(`/interests/${id}`, { cover_path: asset.url })
    setInterest((prev) => prev ? { ...prev, cover_path: asset.url } : prev)
  }

  const saveCoverSettings = async () => {
    if (!id) return
    setCoverSaving(true)
    await api.patch(`/interests/${id}`, { cover_settings: coverSettings })
    setCoverDirty(false)
    setCoverSaving(false)
  }

  const handleSettingsChange = (s: CoverSettings) => {
    setCoverSettings(s)
    setCoverDirty(true)
  }

  const addFeed = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFeed.trim() || !id) return
    await fetch('/api/v1/plugins/rss-feed/feeds', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: newFeed.trim(), interest_id: id }),
    }).then((r) => r.json()).then((d) => { setFeeds(d.feeds?.filter((f: FeedEntry) => f.interest_id === id) ?? []); setNewFeed('') })
  }

  const removeFeed = async (entry: FeedEntry) => {
    await fetch('/api/v1/plugins/rss-feed/feeds', {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: entry.url, interest_id: entry.interest_id }),
    }).then((r) => r.json()).then((d) => setFeeds(d.feeds?.filter((f: FeedEntry) => f.interest_id === id) ?? []))
  }

  const deleteAsset = async (assetId: string) => {
    await api.del(`/media/${assetId}`)
    setMedia((prev) => prev.filter((m) => m.id !== assetId))
  }

  if (!interest) return <div className="p-6 text-text-3">Loading…</div>

  const showProjectTab = pluginReady && pluginCount > 0 && interest.kind === 'project'

  const images = media.filter((m) => m.kind === 'image')
  const audios = media.filter((m) => m.kind === 'audio')
  const others = media.filter((m) => m.kind !== 'image' && m.kind !== 'audio')

  const tabs: { id: Tab; label: string; show?: boolean }[] = [
    { id: 'notes',   label: 'Notes' },
    { id: 'media',   label: `Media${media.length > 0 ? ` (${media.length})` : ''}` },
    { id: 'feeds',   label: `Feeds${feeds.length > 0 ? ` (${feeds.length})` : ''}` },
    { id: 'project', label: project?.type ? `${project.type.charAt(0).toUpperCase() + project.type.slice(1)} project` : 'Project', show: showProjectTab },
    { id: 'settings', label: 'Settings' },
  ]

  return (
    <div className="max-w-4xl mx-auto">
      {/* Cover hero */}
      <CoverHero
        title={interest.title}
        coverUrl={interest.cover_path ?? null}
        settings={coverSettings}
        editable
        onUpload={uploadCover}
        onSettingsChange={handleSettingsChange}
      />

      <div className="px-6 pt-3 pb-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-text-3 mb-1">
        <Link to="/interests" className="hover:text-accent">Interests</Link>
        <span>/</span>
        <span>{interest.kind}</span>
      </div>
      {interest.description && (
        <p className="text-sm text-text-2 mb-4">{interest.description}</p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-bg-3">
        {tabs.filter((t) => t.show !== false).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm transition-colors border-b-2 -mb-px ${
              tab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-2 hover:text-text-1'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Notes tab */}
      {tab === 'notes' && (
        <div className="space-y-2">
          <div className="flex justify-end mb-2">
            <Link to={`/notes/new?interest_id=${id}`} className="btn-primary text-sm">+ Note</Link>
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-text-3">No notes yet.</p>
          ) : (
            notes.map((n) => (
              <Link key={n.id} to={`/notes/${n.id}`}
                className="card flex items-center justify-between px-4 py-3 hover:border-accent/40 transition-colors">
                <span className="text-sm text-text-1">{n.title}</span>
                <span className="text-xs text-text-3">{formatRelative(n.updated_at)}</span>
              </Link>
            ))
          )}
        </div>
      )}

      {/* Media tab */}
      {tab === 'media' && (
        <div className="space-y-6">
          <DropZone interestId={id} onUploaded={loadMedia} />

          {audios.length > 0 && (
            <section>
              <h3 className="text-xs text-text-3 uppercase tracking-wide mb-2">Audio</h3>
              <div className="space-y-2">
                {audios.map((a) => (
                  <div key={a.id} className="group relative">
                    <AudioPlayer src={a.url} title={a.original_name} />
                    <button onClick={() => deleteAsset(a.id)}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-bg-4 text-text-3 hover:text-danger"
                      aria-label="Delete"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {images.length > 0 && (
            <section>
              <h3 className="text-xs text-text-3 uppercase tracking-wide mb-2">Images</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {images.map((img) => (
                  <div key={img.id} className="group relative rounded-lg overflow-hidden border border-bg-3 hover:border-accent/40 transition-colors bg-bg-2">
                    <img src={img.url} alt={img.original_name} className="w-full aspect-square object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-bg-1/80 px-2 py-1 text-[10px] text-text-2 truncate">
                      {img.original_name}
                    </div>
                    <button onClick={() => deleteAsset(img.id)}
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded bg-bg-1/80 text-text-3 hover:text-danger"
                      aria-label="Delete"><Trash2 size={12} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section>
              <h3 className="text-xs text-text-3 uppercase tracking-wide mb-2">Files</h3>
              <div className="space-y-1">
                {others.map((f) => (
                  <div key={f.id} className="group card flex items-center gap-3 px-3 py-2.5 hover:border-accent/40 transition-colors">
                    <KindIcon kind={f.kind} />
                    <a href={f.url} download={f.original_name}
                      className="flex-1 text-sm text-text-1 hover:text-accent truncate min-w-0">
                      {f.original_name}
                    </a>
                    <span className="text-xs text-text-3 shrink-0">{f.kind}</span>
                    <button onClick={() => deleteAsset(f.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-bg-4 text-text-3 hover:text-danger"
                      aria-label="Delete"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {media.length === 0 && (
            <p className="text-sm text-text-3 text-center py-4">No files yet — drop something above.</p>
          )}
        </div>
      )}

      {/* Feeds tab */}
      {tab === 'feeds' && (
        <div className="space-y-4 max-w-xl">
          <p className="text-xs text-text-3">RSS / Atom feeds subscribed to this interest. New items appear in the global feed tagged to this interest.</p>

          <form onSubmit={addFeed} className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              placeholder="https://example.com/feed.xml"
              value={newFeed}
              onChange={(e) => setNewFeed(e.target.value)}
              type="url"
            />
            <button type="submit" className="btn-primary flex items-center gap-1.5 text-sm">
              <Plus size={14} /> Subscribe
            </button>
          </form>

          {feeds.length === 0 ? (
            <p className="text-sm text-text-3">No feeds subscribed yet.</p>
          ) : (
            <div className="space-y-1">
              {feeds.map((f) => (
                <div key={f.url} className="card flex items-center gap-2 px-3 py-2.5 hover:border-accent/40 transition-colors">
                  <Rss size={13} className="text-accent shrink-0" />
                  <span className="flex-1 text-sm text-text-2 truncate">{f.url}</span>
                  <button onClick={() => removeFeed(f)} className="text-text-3 hover:text-danger p-1" aria-label="Unsubscribe">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Project plugin tab */}
      {tab === 'project' && id && (
        <PluginSlot name="interest.project" interestId={id} projectType={project?.type ?? 'generic'} />
      )}

      {tab === 'settings' && (
        <div className="space-y-6 max-w-sm">
          <div>
            <h3 className="text-xs text-text-3 uppercase tracking-wide mb-2">Cover image</h3>
            <p className="text-xs text-text-3 mb-3">Click "Edit cover" on the hero above to upload an image and adjust blur, brightness, tint, zoom, and position. Changes are previewed live.</p>
            {coverDirty && (
              <button
                onClick={saveCoverSettings}
                disabled={coverSaving}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                <Save size={13} /> {coverSaving ? 'Saving…' : 'Save cover settings'}
              </button>
            )}
          </div>

          <div>
            <h3 className="text-xs text-text-3 uppercase tracking-wide mb-2">Danger zone</h3>
            <button
              onClick={async () => {
                if (!id || !confirm(`Archive "${interest.title}"?`)) return
                await api.patch(`/interests/${id}`, { archived: true })
                window.history.back()
              }}
              className="text-xs text-danger border border-danger/30 hover:bg-danger/10 px-3 py-1.5 rounded-md transition-colors"
            >
              Archive interest
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
