import { useEffect, useState, useCallback } from 'react'
import { BookOpen, ListChecks, Plus, Trash2, Download, Upload, ExternalLink, X } from 'lucide-react'
import { api } from '@/api/client'

interface Reference {
  id: string
  title: string
  authors: string[]
  year: number | null
  doi: string | null
  url: string | null
  tags: string[]
  status: string
  source_app: string | null
}

const STATUSES = ['queued', 'reading', 'done'] as const
type Tab = 'library' | 'queue'

function RefRow({ r, onStatus, onDelete }: {
  r: Reference; onStatus: (s: string) => void; onDelete: () => void
}) {
  const link = r.url || (r.doi ? `https://doi.org/${r.doi}` : null)
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-bg-3 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-text-1 font-medium truncate">{r.title}</span>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="text-text-3 hover:text-accent shrink-0">
              <ExternalLink size={13} />
            </a>
          )}
        </div>
        <div className="text-xs text-text-3 truncate">
          {(r.authors || []).join(', ') || 'Unknown'}{r.year ? ` · ${r.year}` : ''}
          {r.source_app && r.source_app !== 'manual' ? ` · ${r.source_app}` : ''}
        </div>
      </div>
      <select
        value={r.status} onChange={(e) => onStatus(e.target.value)}
        className="text-xs bg-bg-2 border border-bg-3 rounded px-1.5 py-1 text-text-2"
      >
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <button onClick={onDelete} className="text-text-3 hover:text-[var(--color-danger)] p-1">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export default function ResearchProjectWidget(props: Record<string, unknown>) {
  const interestId = props.interestId as string
  const base = `/plugins/research-project/references/${interestId}`

  const [refs, setRefs] = useState<Reference[]>([])
  const [tab, setTab] = useState<Tab>('library')
  const [adding, setAdding] = useState(false)
  const [doi, setDoi] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [bibtex, setBibtex] = useState('')

  const load = useCallback(() => { api.get<Reference[]>(base).then(setRefs) }, [base])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!doi.trim() && !title.trim()) return
    setBusy(true); setErr(null)
    try {
      await api.post(base, doi.trim() ? { doi: doi.trim() } : { title: title.trim() })
      setDoi(''); setTitle(''); setAdding(false); load()
    } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const setStatus = async (id: string, status: string) => { await api.patch(`${base}/${id}`, { status }); load() }
  const del = async (id: string) => { await api.del(`${base}/${id}`); load() }
  const importBib = async () => {
    setBusy(true)
    try { await api.post(`${base}/import-bibtex`, { bibtex }); setBibtex(''); setShowImport(false); load() }
    finally { setBusy(false) }
  }

  const shown = tab === 'queue' ? refs.filter((r) => r.status !== 'done') : refs

  const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'library', label: 'Library', Icon: BookOpen },
    { id: 'queue', label: 'Reading queue', Icon: ListChecks },
  ]

  return (
    <div className="space-y-4">
      {/* sub-tabs + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 text-sm px-2.5 py-1.5 rounded-md border transition-colors ${
              tab === id ? 'border-accent text-accent bg-accent/10' : 'border-bg-3 text-text-2 hover:border-accent/50'
            }`}
          >
            <Icon size={14} /> {label}
            {id === 'queue' && refs.some((r) => r.status !== 'done') && (
              <span className="text-xs">({refs.filter((r) => r.status !== 'done').length})</span>
            )}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setShowImport((v) => !v)} className="btn-ghost flex items-center gap-1 text-xs">
            <Upload size={13} /> Import .bib
          </button>
          <a href={`/api/v1${base}/export.bib`} target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1 text-xs">
            <Download size={13} /> Export
          </a>
          <button onClick={() => setAdding((v) => !v)} className="btn-primary flex items-center gap-1 text-xs">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* add form */}
      {adding && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={doi} onChange={(e) => setDoi(e.target.value)}
              placeholder="DOI (e.g. 10.1038/nphys1170)"
              className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-text-3">or</span>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Title (manual)"
              className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
            />
            <button onClick={add} disabled={busy} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Adding…' : 'Add'}
            </button>
          </div>
          {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
          <p className="text-xs text-text-3">A DOI is resolved via Crossref (title, authors, year filled in automatically).</p>
        </div>
      )}

      {/* import bibtex */}
      {showImport && (
        <div className="card p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-2">Paste BibTeX</span>
            <button onClick={() => setShowImport(false)} className="text-text-3"><X size={14} /></button>
          </div>
          <textarea
            value={bibtex} onChange={(e) => setBibtex(e.target.value)} rows={6}
            placeholder="@article{key, title={…}, author={…}, year={…}}"
            className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-xs font-mono"
          />
          <button onClick={importBib} disabled={busy || !bibtex.trim()} className="btn-primary text-sm disabled:opacity-50">
            Import
          </button>
        </div>
      )}

      {/* list */}
      <div className="card p-3">
        {shown.length === 0 ? (
          <p className="text-sm text-text-3 text-center py-6">
            {tab === 'queue' ? 'Nothing queued — all caught up.' : 'No references yet. Add one by DOI or import a .bib file.'}
          </p>
        ) : (
          shown.map((r) => (
            <RefRow key={r.id} r={r} onStatus={(s) => setStatus(r.id, s)} onDelete={() => del(r.id)} />
          ))
        )}
      </div>
    </div>
  )
}
