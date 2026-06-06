import { useEffect, useState, useCallback } from 'react'
import { GitMerge, RefreshCw, Check, Download, HardDrive, ExternalLink } from 'lucide-react'
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
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([
      api.get<SyncStatus>('/sync/status'),
      api.get<Conflict[]>('/sync/conflicts'),
    ])
    setStatus(s); setConflicts(c)
  }, [])

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
