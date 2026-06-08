import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Code2, KeyRound, Link2, FileText, CircleDot, GitPullRequest, GitCommit,
  ExternalLink, Settings2, RefreshCw, GitBranch, FolderGit2, DownloadCloud,
  ArrowLeft, Plus, CheckCircle2, Send, Upload, Download, Trash2,
  ListTodo, Square, CheckSquare, File as FileIcon,
} from 'lucide-react'
import { api } from '@/api/client'

const BASE = '/plugins/code-project'

interface Settings { configured: boolean; login: string | null; error?: string }
interface RepoStatus {
  exists: boolean
  token_configured: boolean
  github: { owner: string; repo: string } | null
  branch?: string | null
  head?: string
  remote_url?: string | null
  file_count?: number
  dirty?: boolean
  readme?: string
}
interface Issue { number: number; title: string; labels: string[]; comments: number; html_url: string; user: string; updated_at: string }
interface Pull { number: number; title: string; user: string; html_url: string; draft: boolean }
interface LocalCommit { sha: string; author: string; date: string; message: string }
interface Task { id: string; title: string; body: string; status: 'open' | 'done'; position: number }
interface IssueComment { user: string; body: string; created_at: string }
interface IssueFull {
  number: number; title: string; body: string; state: string; user: string
  labels: string[]; html_url: string; comments: IssueComment[]
}

type Tab = 'overview' | 'files' | 'commits' | 'tasks' | 'issues' | 'pulls'

/* ── Issue detail (two-way GitHub) ───────────────────────────────────────── */
function IssueDetail({ interestId, number, onBack, onChanged }: {
  interestId: string; number: number; onBack: () => void; onChanged: () => void
}) {
  const [issue, setIssue] = useState<IssueFull | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<IssueFull>(`${BASE}/issue/${interestId}/${number}`).then(setIssue)
  }, [interestId, number])
  useEffect(() => { load() }, [load])

  const addComment = async () => {
    if (!comment.trim()) return
    setBusy(true)
    try { await api.post(`${BASE}/issue/${interestId}/${number}/comment`, { body: comment }); setComment(''); load() }
    finally { setBusy(false) }
  }
  const toggleState = async () => {
    if (!issue) return
    setBusy(true)
    try {
      await api.patch(`${BASE}/issue/${interestId}/${number}`, { state: issue.state === 'open' ? 'closed' : 'open' })
      load(); onChanged()
    } finally { setBusy(false) }
  }

  if (!issue) return <p className="text-sm text-text-3">Loading…</p>
  const open = issue.state === 'open'

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-text-3 hover:text-accent">
        <ArrowLeft size={13} /> Back to issues
      </button>
      <div className="card p-4 space-y-3">
        <div className="flex items-start gap-2">
          {open ? <CircleDot size={17} className="text-green-500 mt-0.5" /> : <CheckCircle2 size={17} className="text-purple-400 mt-0.5" />}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-1">{issue.title} <span className="text-text-3">#{issue.number}</span></div>
            <div className="text-xs text-text-3">{issue.user} · {open ? 'open' : 'closed'}{issue.labels.length ? ' · ' + issue.labels.join(', ') : ''}</div>
          </div>
          <a href={issue.html_url} target="_blank" rel="noreferrer" className="text-text-3 hover:text-accent"><ExternalLink size={14} /></a>
        </div>
        {issue.body && <pre className="text-sm text-text-1 whitespace-pre-wrap break-words font-sans m-0">{issue.body}</pre>}
      </div>

      {issue.comments.map((c, i) => (
        <div key={i} className="card p-3">
          <div className="text-xs text-text-3 mb-1">{c.user} · {c.created_at ? new Date(c.created_at).toLocaleString() : ''}</div>
          <pre className="text-sm text-text-1 whitespace-pre-wrap break-words font-sans m-0">{c.body}</pre>
        </div>
      ))}

      <div className="card p-3 space-y-2">
        <textarea
          value={comment} onChange={(e) => setComment(e.target.value)} rows={3}
          placeholder="Leave a comment…"
          className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
        />
        <div className="flex items-center gap-2">
          <button onClick={addComment} disabled={busy || !comment.trim()} className="btn-primary text-sm flex items-center gap-1 disabled:opacity-50">
            <Send size={13} /> Comment
          </button>
          <button onClick={toggleState} disabled={busy} className="btn-ghost text-sm flex items-center gap-1 ml-auto">
            {open ? <CheckCircle2 size={14} /> : <CircleDot size={14} />} {open ? 'Close issue' : 'Reopen'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── GitHub token setup (only needed for GitHub features) ─────────────────── */
function TokenSetup({ onSaved, compact }: { onSaved: (s: Settings) => void; compact?: boolean }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try { onSaved(await api.put<Settings>(`${BASE}/settings`, { token: token.trim() })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className={`space-y-3 ${compact ? '' : 'card p-5 max-w-xl'}`}>
      {!compact && (
        <>
          <div className="flex items-center gap-2">
            <Link2 size={18} /> <h3 className="text-sm font-semibold">Connect GitHub</h3>
          </div>
          <p className="text-sm text-text-2">
            GitHub features (clone private repos, push/pull, issues) use a{' '}
            <strong>fine-grained personal access token</strong>. It stays on your server, stored once.
          </p>
          <ol className="text-sm text-text-2 space-y-1.5 list-decimal pl-5">
            <li>GitHub → <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong> → <em>Generate new token</em>.</li>
            <li><strong>Repository access:</strong> select the repos you want GYST to use.</li>
            <li><strong>Permissions:</strong> Contents → <em>Read and write</em>, Issues → <em>Read and write</em>, Pull requests → <em>Read-only</em>.</li>
            <li>Generate, copy the <code>github_pat_…</code> token, and paste it below.</li>
          </ol>
          <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 text-sm text-accent">
            Open token settings <ExternalLink size={13} />
          </a>
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <KeyRound size={15} className="text-text-3" />
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm font-mono"
        />
        <button onClick={save} disabled={busy || !token.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Checking…' : 'Save token'}
        </button>
      </div>
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  )
}

/* ── Landing: no local repo yet ──────────────────────────────────────────── */
function RepoLanding({ interestId, status, onChanged, onTokenSaved }: {
  interestId: string; status: RepoStatus; onChanged: () => void; onTokenSaved: (s: Settings) => void
}) {
  const [mode, setMode] = useState<'choose' | 'clone'>('choose')
  const [name, setName] = useState('')
  const [repo, setRepo] = useState(status.github ? `${status.github.owner}/${status.github.repo}` : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const createLocal = async () => {
    setBusy(true); setErr(null)
    try { await api.post(`${BASE}/repo/${interestId}/init`, { name: name.trim() }); onChanged() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const clone = async () => {
    setBusy(true); setErr(null)
    try { await api.post(`${BASE}/repo/${interestId}/clone`, { repo: repo.trim() }); onChanged() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="flex items-center gap-2">
        <Code2 size={18} /> <h3 className="text-sm font-semibold">Set up this code project</h3>
      </div>

      {mode === 'choose' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium"><FolderGit2 size={16} /> Local repository</div>
            <p className="text-xs text-text-3">Start a fresh git repo on your server. No GitHub needed — connect one later if you want.</p>
            <input
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name (optional)"
              className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
            />
            <button onClick={createLocal} disabled={busy} className="btn-primary text-sm w-full disabled:opacity-50">
              {busy ? 'Creating…' : 'Create local repo'}
            </button>
          </div>
          <div className="card p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium"><DownloadCloud size={16} /> Clone from GitHub</div>
            <p className="text-xs text-text-3">Pull an existing GitHub repo down to your server. Private repos need a token first.</p>
            <button onClick={() => setMode('clone')} className="btn-ghost text-sm w-full">Clone a repo…</button>
          </div>
        </div>
      )}

      {mode === 'clone' && (
        <div className="card p-4 space-y-3">
          <button onClick={() => setMode('choose')} className="flex items-center gap-1 text-xs text-text-3 hover:text-accent">
            <ArrowLeft size={13} /> Back
          </button>
          <div className="flex items-center gap-2">
            <input
              value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo  (or a GitHub URL)"
              className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
            />
            <button onClick={clone} disabled={busy || !repo.trim()} className="btn-primary text-sm disabled:opacity-50">
              {busy ? 'Cloning…' : 'Clone'}
            </button>
          </div>
          {!status.token_configured && (
            <details className="text-xs text-text-3">
              <summary className="cursor-pointer hover:text-accent">Private repo? Add a GitHub token</summary>
              <div className="pt-2"><TokenSetup compact onSaved={onTokenSaved} /></div>
            </details>
          )}
        </div>
      )}

      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  )
}

/* ── Connect a GitHub remote to an existing local repo ───────────────────── */
function ConnectGitHub({ interestId, status, onClose, onLinked, onTokenSaved }: {
  interestId: string; status: RepoStatus; onClose: () => void
  onLinked: () => void; onTokenSaved: (s: Settings) => void
}) {
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const link = async () => {
    setBusy(true); setErr(null)
    try { await api.post(`${BASE}/repo/${interestId}/remote`, { repo: repo.trim() }); onLinked() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <Link2 size={16} /> <h3 className="text-sm font-semibold">Connect a GitHub remote</h3>
        <button onClick={onClose} className="ml-auto text-xs text-text-3 hover:text-accent">Cancel</button>
      </div>
      {!status.token_configured ? (
        <TokenSetup compact onSaved={onTokenSaved} />
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo  (or a GitHub URL)"
            className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
          />
          <button onClick={link} disabled={busy || !repo.trim()} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Linking…' : 'Connect'}
          </button>
        </div>
      )}
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  )
}

/* ── Tasks tab ───────────────────────────────────────────────────────────── */
function TasksTab({ interestId }: { interestId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { setTasks(await api.get<Task[]>(`${BASE}/tasks/${interestId}`)) } finally { setLoading(false) }
  }, [interestId])
  useEffect(() => { load() }, [load])

  const add = async () => {
    if (!title.trim()) return
    await api.post(`${BASE}/tasks/${interestId}`, { title, body })
    setTitle(''); setBody(''); setAdding(false); load()
  }
  const toggle = async (t: Task) => {
    await api.patch(`${BASE}/tasks/${interestId}/${t.id}`, { status: t.status === 'open' ? 'done' : 'open' })
    load()
  }
  const remove = async (t: Task) => { await api.del(`${BASE}/tasks/${interestId}/${t.id}`); load() }

  const open = tasks.filter((t) => t.status === 'open')
  const done = tasks.filter((t) => t.status === 'done')

  const Row = (t: Task) => (
    <div key={t.id} className="flex items-start gap-2 p-3 group">
      <button onClick={() => toggle(t)} className="mt-0.5 text-text-3 hover:text-accent shrink-0">
        {t.status === 'done' ? <CheckSquare size={16} className="text-green-500" /> : <Square size={16} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${t.status === 'done' ? 'text-text-3 line-through' : 'text-text-1'}`}>{t.title}</div>
        {t.body && <div className="text-xs text-text-3 whitespace-pre-wrap">{t.body}</div>}
      </div>
      <button onClick={() => remove(t)} className="text-text-3 hover:text-[var(--color-danger)] opacity-0 group-hover:opacity-100 shrink-0">
        <Trash2 size={14} />
      </button>
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex">
        <button onClick={() => setAdding((v) => !v)} className="btn-primary text-sm flex items-center gap-1 ml-auto">
          <Plus size={14} /> Add task
        </button>
      </div>
      {adding && (
        <div className="card p-3 space-y-2">
          <input
            value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title"
            className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
          />
          <textarea
            value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Notes (optional)"
            className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
          />
          <button onClick={add} disabled={!title.trim()} className="btn-primary text-sm disabled:opacity-50">Add</button>
        </div>
      )}
      {loading ? <p className="text-sm text-text-3">Loading…</p> : (
        <>
          <div className="card divide-y divide-bg-3">
            {open.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No open tasks.</p> : open.map(Row)}
          </div>
          {done.length > 0 && (
            <div>
              <div className="text-xs text-text-3 mb-1 mt-2">Done ({done.length})</div>
              <div className="card divide-y divide-bg-3 opacity-70">{done.map(Row)}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── Files tab ───────────────────────────────────────────────────────────── */
function FilesTab({ interestId }: { interestId: string }) {
  const [files, setFiles] = useState<string[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { api.get<{ files: string[] }>(`${BASE}/repo/${interestId}/files`).then((r) => setFiles(r.files)) }, [interestId])

  const openFile = async (rel: string) => {
    setSel(rel); setErr(null); setContent('')
    try {
      const r = await api.get<{ content: string }>(`${BASE}/repo/${interestId}/file?rel=${encodeURIComponent(rel)}`)
      setContent(r.content)
    } catch (e) { setErr((e as Error).message) }
  }

  if (sel) return (
    <div className="space-y-2">
      <button onClick={() => setSel(null)} className="flex items-center gap-1 text-xs text-text-3 hover:text-accent">
        <ArrowLeft size={13} /> {sel}
      </button>
      {err ? <p className="text-sm text-[var(--color-danger)]">{err}</p> :
        <pre className="card p-4 text-xs text-text-1 overflow-x-auto max-h-[30rem]">{content}</pre>}
    </div>
  )

  return (
    <div className="card divide-y divide-bg-3 max-h-[30rem] overflow-y-auto">
      {files.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No tracked files yet.</p> :
        files.map((f) => (
          <button key={f} onClick={() => openFile(f)} className="flex items-center gap-2 p-2 px-3 hover:bg-bg-2 w-full text-left">
            <FileIcon size={13} className="text-text-3 shrink-0" />
            <span className="text-sm text-text-1 truncate">{f}</span>
          </button>
        ))}
    </div>
  )
}

/* ── Main widget ─────────────────────────────────────────────────────────── */
export default function CodeProjectWidget(props: Record<string, unknown>) {
  const interestId = props.interestId as string
  const [repo, setRepo] = useState<RepoStatus | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [connecting, setConnecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [issues, setIssues] = useState<Issue[]>([])
  const [pulls, setPulls] = useState<Pull[]>([])
  const [commits, setCommits] = useState<LocalCommit[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selIssue, setSelIssue] = useState<number | null>(null)
  const [newIssue, setNewIssue] = useState(false)
  const [niTitle, setNiTitle] = useState('')
  const [niBody, setNiBody] = useState('')

  const loadRepo = useCallback(async () => {
    setRepo(await api.get<RepoStatus>(`${BASE}/repo/${interestId}`))
  }, [interestId])
  useEffect(() => { loadRepo() }, [loadRepo])

  const linked = !!repo?.github

  const loadTab = useCallback(async (t: Tab) => {
    if (!repo?.exists) return
    setLoading(true); setErr(null)
    try {
      if (t === 'commits') setCommits(await api.get<LocalCommit[]>(`${BASE}/repo/${interestId}/commits`))
      if (t === 'issues' && linked) setIssues(await api.get<Issue[]>(`${BASE}/issues/${interestId}`))
      if (t === 'pulls' && linked) setPulls(await api.get<Pull[]>(`${BASE}/pulls/${interestId}`))
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [interestId, repo, linked])

  useEffect(() => { if (repo?.exists) loadTab(tab) }, [tab, repo, loadTab])

  const gitAction = async (action: 'push' | 'pull') => {
    setBusy(true); setMsg(null); setErr(null)
    try { await api.post(`${BASE}/repo/${interestId}/${action}`, {}); setMsg(`${action === 'push' ? 'Pushed' : 'Pulled'} ✓`); loadRepo() }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const disconnect = async () => { await api.del(`${BASE}/link/${interestId}`); loadRepo() }
  const createIssue = async () => {
    if (!niTitle.trim()) return
    await api.post(`${BASE}/issues/${interestId}`, { title: niTitle, body: niBody })
    setNewIssue(false); setNiTitle(''); setNiBody(''); loadTab('issues')
  }

  if (!repo) return <div className="text-text-3 text-sm">Loading…</div>

  // No local repo yet → landing.
  if (!repo.exists) {
    return <RepoLanding interestId={interestId} status={repo} onChanged={loadRepo} onTokenSaved={() => loadRepo()} />
  }

  const TABS: { id: Tab; label: string; Icon: React.ElementType; gh?: boolean }[] = [
    { id: 'overview', label: 'Overview', Icon: FileText },
    { id: 'files', label: 'Files', Icon: FolderGit2 },
    { id: 'commits', label: 'Commits', Icon: GitCommit },
    { id: 'tasks', label: 'Tasks', Icon: ListTodo },
    { id: 'issues', label: 'Issues', Icon: CircleDot, gh: true },
    { id: 'pulls', label: 'Pull requests', Icon: GitPullRequest, gh: true },
  ]
  const visibleTabs = TABS.filter((t) => !t.gh || linked)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Code2 size={15} /> {linked ? `${repo.github!.owner}/${repo.github!.repo}` : 'Local repository'}
        </span>
        {repo.branch && (
          <span className="flex items-center gap-1 text-xs text-text-3"><GitBranch size={12} /> {repo.branch}</span>
        )}
        {repo.dirty && <span className="text-xs text-amber-500">uncommitted changes</span>}
        <div className="ml-auto flex items-center gap-1">
          {linked && (
            <>
              <button onClick={() => gitAction('pull')} disabled={busy} className="btn-ghost p-1.5" title="Pull from GitHub"><Download size={14} /></button>
              <button onClick={() => gitAction('push')} disabled={busy} className="btn-ghost p-1.5" title="Push to GitHub"><Upload size={14} /></button>
              <button onClick={disconnect} className="btn-ghost p-1.5" title="Disconnect GitHub"><Settings2 size={14} /></button>
            </>
          )}
          {!linked && (
            <button onClick={() => setConnecting(true)} className="btn-ghost text-xs flex items-center gap-1 px-2 py-1">
              <Link2 size={13} /> Connect GitHub
            </button>
          )}
          <button onClick={() => { loadRepo(); loadTab(tab) }} className="btn-ghost p-1.5" title="Refresh"><RefreshCw size={14} /></button>
        </div>
      </div>

      {msg && <p className="text-xs text-green-500">{msg}</p>}

      {connecting && (
        <ConnectGitHub
          interestId={interestId} status={repo}
          onClose={() => setConnecting(false)}
          onLinked={() => { setConnecting(false); loadRepo() }}
          onTokenSaved={() => loadRepo()}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b border-bg-3 pb-2">
        {visibleTabs.map(({ id, label, Icon }) => (
          <button
            key={id} onClick={() => { setTab(id); setSelIssue(null); setNewIssue(false) }}
            className={`flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-md transition-colors ${
              tab === id ? 'text-accent bg-accent/10' : 'text-text-2 hover:text-accent'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {err && <p className="text-sm text-[var(--color-danger)]">{err}</p>}
      {loading && <p className="text-sm text-text-3">Loading…</p>}

      {tab === 'overview' && (
        repo.readme
          ? <div className="card p-5 gh-readme text-sm max-h-[28rem] overflow-y-auto">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{repo.readme}</ReactMarkdown>
            </div>
          : <div className="card p-5 text-sm text-text-3">
              No README yet. {repo.file_count} tracked file{repo.file_count === 1 ? '' : 's'} ·{' '}
              {repo.head ? <>head <code>{repo.head}</code></> : 'no commits yet'}
            </div>
      )}

      {tab === 'files' && <FilesTab interestId={interestId} />}

      {tab === 'tasks' && <TasksTab interestId={interestId} />}

      {tab === 'commits' && !loading && (
        <div className="card divide-y divide-bg-3">
          {commits.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No commits yet.</p> :
            commits.map((c) => (
              <div key={c.sha} className="flex items-start gap-2 p-3">
                <GitCommit size={15} className="text-text-3 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-1 truncate">{c.message}</div>
                  <div className="text-xs text-text-3">{c.author} · <code>{c.sha}</code> · {c.date ? new Date(c.date).toLocaleString() : ''}</div>
                </div>
              </div>
            ))}
        </div>
      )}

      {tab === 'issues' && linked && (
        selIssue !== null ? (
          <IssueDetail
            interestId={interestId} number={selIssue}
            onBack={() => { setSelIssue(null); loadTab('issues') }}
            onChanged={() => loadTab('issues')}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex">
              <button onClick={() => setNewIssue((v) => !v)} className="btn-primary text-sm flex items-center gap-1 ml-auto">
                <Plus size={14} /> New issue
              </button>
            </div>
            {newIssue && (
              <div className="card p-3 space-y-2">
                <input
                  value={niTitle} onChange={(e) => setNiTitle(e.target.value)} placeholder="Issue title"
                  className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
                />
                <textarea
                  value={niBody} onChange={(e) => setNiBody(e.target.value)} rows={4} placeholder="Description (optional, markdown)"
                  className="w-full bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
                />
                <button onClick={createIssue} disabled={!niTitle.trim()} className="btn-primary text-sm disabled:opacity-50">
                  Create on GitHub
                </button>
              </div>
            )}
            {!loading && (
              <div className="card divide-y divide-bg-3">
                {issues.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No open issues.</p> :
                  issues.map((i) => (
                    <button key={i.number} onClick={() => setSelIssue(i.number)} className="flex items-start gap-2 p-3 hover:bg-bg-2 w-full text-left">
                      <CircleDot size={15} className="text-green-500 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm text-text-1">{i.title} <span className="text-text-3">#{i.number}</span></div>
                        <div className="text-xs text-text-3">
                          {i.user}{i.labels.length ? ' · ' + i.labels.join(', ') : ''}{i.comments ? ` · ${i.comments} comments` : ''}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )
      )}

      {tab === 'pulls' && linked && !loading && (
        <div className="card divide-y divide-bg-3">
          {pulls.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No open pull requests.</p> :
            pulls.map((p) => (
              <a key={p.number} href={p.html_url} target="_blank" rel="noreferrer" className="flex items-start gap-2 p-3 hover:bg-bg-2">
                <GitPullRequest size={15} className="text-accent mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-text-1">{p.title} <span className="text-text-3">#{p.number}</span>{p.draft && <span className="text-xs text-text-3"> · draft</span>}</div>
                  <div className="text-xs text-text-3">{p.user}</div>
                </div>
              </a>
            ))}
        </div>
      )}
    </div>
  )
}
