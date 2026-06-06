import { useEffect, useState, useCallback } from 'react'
import {
  GitMerge, RefreshCw, Check, Download, HardDrive, ExternalLink,
  FolderKanban, Layers, FileText,
} from 'lucide-react'
import { api } from '@/api/client'

interface SyncStatus {
  gitea_enabled: boolean
  import_enabled: boolean
  gitea_url: string | null
  open_conflicts: number
}

interface Conflict {
  id: number
  note_id: string
  note_title: string
  ours_title: string
  ours_body: string
  theirs_title: string
  theirs_body: string
  created_at: string
}

type Choice = 'local' | 'incoming'

interface SyncItem { id: string; label: string; sync_enabled: boolean }

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <button
      onClick={() => onChange(!on)} disabled={disabled} aria-pressed={on}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-accent' : 'bg-bg-3'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  )
}

function SelectGroup({
  icon, title, items, onToggle, busy, empty,
}: {
  icon: React.ReactNode; title: string; items: SyncItem[]
  onToggle: (id: string, on: boolean) => void; busy: boolean; empty: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 text-xs font-medium text-text-3 uppercase tracking-wide">
        {icon} {title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-text-3 pl-6">{empty}</p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 pl-6 pr-1 py-1">
            <span className="text-sm text-text-1 truncate">{it.label}</span>
            <Toggle on={it.sync_enabled} disabled={busy} onChange={(v) => onToggle(it.id, v)} />
          </div>
        ))
      )}
    </div>
  )
}

function Side({
  label, title, body, tone, icon, onPick, picking,
}: {
  label: string; title: string; body: string; tone: 'local' | 'incoming'
  icon: React.ReactNode; onPick: () => void; picking: boolean
}) {
  const accent = tone === 'local' ? 'var(--color-accent)' : '#22c55e'
  return (
    <div className="flex-1 min-w-0 flex flex-col border border-bg-3 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bg-3 bg-bg-2">
        <span style={{ color: accent }}>{icon}</span>
        <span className="text-xs font-medium text-text-2 uppercase tracking-wide">{label}</span>
        <span className="text-xs text-text-3 truncate ml-1">{title}</span>
      </div>
      <pre className="flex-1 p-3 text-xs text-text-1 whitespace-pre-wrap break-words font-mono max-h-72 overflow-y-auto m-0">
        {body || <span className="text-text-3">(empty)</span>}
      </pre>
      <button
        className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium border-t border-bg-3 hover:bg-bg-3 transition-colors disabled:opacity-50"
        style={{ color: accent }}
        onClick={onPick}
        disabled={picking}
      >
        <Check size={15} />
        {tone === 'local' ? 'Keep this' : 'Accept this'}
      </button>
    </div>
  )
}

export default function Sync() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [projects, setProjects] = useState<SyncItem[]>([])
  const [contents, setContents] = useState<SyncItem[]>([])
  const [folders, setFolders] = useState<SyncItem[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, c, proj, cont, fold] = await Promise.all([
      api.get<SyncStatus>('/sync/status'),
      api.get<Conflict[]>('/sync/conflicts'),
      api.get<{ id: string; title: string; sync_enabled: boolean }[]>('/interests?kind=project&archived=false'),
      api.get<{ id: string; title: string; sync_enabled: boolean }[]>('/interests?kind=content&archived=false'),
      api.get<{ id: string; name: string; sync_enabled: boolean }[]>('/folders?entity_type=note'),
    ])
    setStatus(s); setConflicts(c)
    setProjects(proj.map((p) => ({ id: p.id, label: p.title, sync_enabled: p.sync_enabled })))
    setContents(cont.map((p) => ({ id: p.id, label: p.title, sync_enabled: p.sync_enabled })))
    setFolders(fold.map((f) => ({ id: f.id, label: f.name, sync_enabled: f.sync_enabled })))
  }, [])

  const toggleInterest = async (id: string, on: boolean) => {
    setBusy(true)
    try {
      await api.patch(`/interests/${id}`, { sync_enabled: on })
      const upd = (xs: SyncItem[]) => xs.map((x) => (x.id === id ? { ...x, sync_enabled: on } : x))
      setProjects(upd); setContents(upd)
    } finally { setBusy(false) }
  }
  const toggleFolder = async (id: string, on: boolean) => {
    setBusy(true)
    try {
      await api.patch(`/folders/${id}`, { sync_enabled: on })
      setFolders((xs) => xs.map((x) => (x.id === id ? { ...x, sync_enabled: on } : x)))
    } finally { setBusy(false) }
  }

  useEffect(() => { load() }, [load])

  const syncNow = async () => {
    setBusy(true); setMsg(null)
    try { await api.post('/sync/run'); setMsg('Synced.'); await load() }
    catch (e) { setMsg('Sync failed: ' + (e as Error).message) }
    finally { setBusy(false) }
  }

  const resolve = async (id: number, choice: Choice) => {
    setBusy(true); setMsg(null)
    try {
      await api.post(`/sync/conflicts/${id}/resolve`, { choice })
      await api.post('/sync/run')
      await load()
    } finally { setBusy(false) }
  }

  const resolveAll = async (choice: Choice) => {
    setBusy(true); setMsg(null)
    try {
      await api.post('/sync/conflicts/resolve-all', { choice })
      await api.post('/sync/run')
      await load()
    } finally { setBusy(false) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Sync</h1>
        <button
          className="btn-primary ml-auto flex items-center gap-1.5 text-sm disabled:opacity-50"
          onClick={syncNow} disabled={busy}
        >
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
          Sync now
        </button>
      </div>

      {/* Status */}
      {status && (
        <section className="card p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${status.gitea_enabled ? 'bg-green-500' : 'bg-text-3'}`} />
            Gitea {status.gitea_enabled ? 'connected' : 'not configured'}
          </span>
          <span className="text-text-2">
            Desktop import {status.import_enabled ? 'on' : 'off'}
          </span>
          <span className={status.open_conflicts ? 'text-amber-400 font-medium' : 'text-text-2'}>
            {status.open_conflicts} conflict{status.open_conflicts === 1 ? '' : 's'}
          </span>
          {status.gitea_url && (
            <a href={status.gitea_url} target="_blank" rel="noreferrer"
               className="flex items-center gap-1 text-text-3 hover:text-accent ml-auto">
              Open Gitea <ExternalLink size={13} />
            </a>
          )}
        </section>
      )}

      {msg && <p className="text-sm text-text-3">{msg}</p>}

      {/* What syncs */}
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide">What syncs</h2>
        <p className="text-xs text-text-3 -mt-2">
          Each enabled project becomes its own Gitea repo; enabled content and note
          folders go to the <code>personal</code> repo. Changes propagate on the next sync.
        </p>
        <div className="card p-4 space-y-5">
          <SelectGroup
            icon={<FolderKanban size={13} />} title="Projects" items={projects}
            onToggle={toggleInterest} busy={busy} empty="No projects yet."
          />
          <SelectGroup
            icon={<Layers size={13} />} title="Content" items={contents}
            onToggle={toggleInterest} busy={busy} empty="No content interests."
          />
          <SelectGroup
            icon={<FileText size={13} />} title="Note folders" items={folders}
            onToggle={toggleFolder} busy={busy} empty="No note folders."
          />
        </div>
      </section>

      {/* Conflicts */}
      <section className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide flex items-center gap-2">
            <GitMerge size={15} /> Conflicts
          </h2>
          {conflicts.length > 0 && (
            <div className="flex gap-2 ml-auto">
              <button
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-bg-3 hover:bg-bg-3 disabled:opacity-50"
                style={{ color: '#22c55e' }}
                onClick={() => resolveAll('incoming')} disabled={busy}
              >
                <Download size={13} /> Accept all incoming
              </button>
              <button
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-bg-3 hover:bg-bg-3 disabled:opacity-50"
                style={{ color: 'var(--color-accent)' }}
                onClick={() => resolveAll('local')} disabled={busy}
              >
                <HardDrive size={13} /> Keep all local
              </button>
            </div>
          )}
        </div>

        {conflicts.length === 0 ? (
          <div className="card p-8 text-center text-text-3 text-sm">
            No conflicts — everything's in sync. ✨
          </div>
        ) : (
          conflicts.map((c) => (
            <div key={c.id} className="card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-1">{c.note_title}</span>
                <span className="text-xs text-text-3 ml-auto">
                  {new Date(c.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col md:flex-row gap-3">
                <Side
                  label="Local (GYST)" title={c.ours_title} body={c.ours_body}
                  tone="local" icon={<HardDrive size={14} />} picking={busy}
                  onPick={() => resolve(c.id, 'local')}
                />
                <Side
                  label="Incoming (desktop)" title={c.theirs_title} body={c.theirs_body}
                  tone="incoming" icon={<Download size={14} />} picking={busy}
                  onPick={() => resolve(c.id, 'incoming')}
                />
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
