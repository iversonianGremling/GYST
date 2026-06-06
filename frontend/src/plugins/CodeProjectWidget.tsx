import { useEffect, useState, useCallback } from 'react'
import {
  Code2, KeyRound, Link2, FileText, CircleDot, GitPullRequest, GitCommit,
  ExternalLink, Star, Check, Settings2, RefreshCw,
  ArrowLeft, Plus, MessageSquare, CheckCircle2, Send,
} from 'lucide-react'
import { api } from '@/api/client'

interface Settings { configured: boolean; login: string | null; error?: string }
interface Link { owner?: string; repo?: string }
interface Overview {
  full_name: string; description: string | null; language: string | null
  stars: number; open_issues: number; default_branch: string; pushed_at: string
  html_url: string; readme_html: string
}
interface Issue { number: number; title: string; labels: string[]; comments: number; html_url: string; user: string; updated_at: string }
interface Pull { number: number; title: string; user: string; html_url: string; draft: boolean }
interface Commit { sha: string; message: string; author: string; date: string; html_url: string }
interface IssueComment { user: string; body: string; created_at: string }
interface IssueFull {
  number: number; title: string; body: string; state: string; user: string
  labels: string[]; html_url: string; comments: IssueComment[]
}

type Tab = 'overview' | 'issues' | 'pulls' | 'activity'

/* ── Issue detail (two-way) ──────────────────────────────────────────────── */
function IssueDetail({ interestId, number, onBack, onChanged }: {
  interestId: string; number: number; onBack: () => void; onChanged: () => void
}) {
  const base = `/plugins/code-project`
  const [issue, setIssue] = useState<IssueFull | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<IssueFull>(`${base}/issue/${interestId}/${number}`).then(setIssue)
  }, [base, interestId, number])
  useEffect(() => { load() }, [load])

  const addComment = async () => {
    if (!comment.trim()) return
    setBusy(true)
    try { await api.post(`${base}/issue/${interestId}/${number}/comment`, { body: comment }); setComment(''); load() }
    finally { setBusy(false) }
  }
  const toggleState = async () => {
    if (!issue) return
    setBusy(true)
    try {
      await api.patch(`${base}/issue/${interestId}/${number}`, { state: issue.state === 'open' ? 'closed' : 'open' })
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

/* ── Token setup ─────────────────────────────────────────────────────────── */
function TokenSetup({ onSaved }: { onSaved: (s: Settings) => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true); setErr(null)
    try { onSaved(await api.put<Settings>('/plugins/code-project/settings', { token: token.trim() })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card p-5 space-y-4 max-w-xl">
      <div className="flex items-center gap-2">
        <Code2 size={18} /> <h3 className="text-sm font-semibold">Connect GitHub</h3>
      </div>
      <p className="text-sm text-text-2">
        Code projects connect to a GitHub repo with a <strong>fine-grained personal access token</strong>.
        Create one (it stays on your server, stored once):
      </p>
      <ol className="text-sm text-text-2 space-y-1.5 list-decimal pl-5">
        <li>GitHub → <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong> → <em>Generate new token</em>.</li>
        <li><strong>Repository access:</strong> select the repos you want GYST to see.</li>
        <li><strong>Permissions:</strong> Contents → <em>Read-only</em>, Issues → <em>Read and write</em>, Pull requests → <em>Read-only</em>.</li>
        <li>Generate, copy the <code>github_pat_…</code> token, and paste it below.</li>
      </ol>
      <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer"
         className="inline-flex items-center gap-1 text-sm text-accent">
        Open token settings <ExternalLink size={13} />
      </a>
      <div className="flex items-center gap-2 pt-1">
        <KeyRound size={15} className="text-text-3" />
        <input
          type="password" value={token} onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm font-mono"
        />
        <button onClick={save} disabled={busy || !token.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Checking…' : 'Connect'}
        </button>
      </div>
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  )
}

/* ── Repo link ───────────────────────────────────────────────────────────── */
function RepoLink({ interestId, login, onLinked, onReset }: {
  interestId: string; login: string | null; onLinked: (l: Link) => void; onReset: () => void
}) {
  const [repo, setRepo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const link = async () => {
    setBusy(true); setErr(null)
    try { onLinked(await api.put<Link>(`/plugins/code-project/link/${interestId}`, { repo: repo.trim() })) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="card p-5 space-y-3 max-w-xl">
      <div className="flex items-center gap-2">
        <Link2 size={16} /> <h3 className="text-sm font-semibold">Link a repository</h3>
        <span className="text-xs text-text-3 ml-auto flex items-center gap-1">
          <Check size={12} className="text-green-500" /> {login}
          <button onClick={onReset} className="ml-2 text-text-3 hover:text-accent underline">change token</button>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={repo} onChange={(e) => setRepo(e.target.value)}
          placeholder="owner/repo  (or a GitHub URL)"
          className="flex-1 bg-bg-2 border border-bg-3 rounded px-2 py-1.5 text-sm"
        />
        <button onClick={link} disabled={busy || !repo.trim()} className="btn-primary text-sm disabled:opacity-50">
          {busy ? 'Linking…' : 'Link'}
        </button>
      </div>
      {err && <p className="text-xs text-[var(--color-danger)]">{err}</p>}
    </div>
  )
}

/* ── Main widget ─────────────────────────────────────────────────────────── */
export default function CodeProjectWidget(props: Record<string, unknown>) {
  const interestId = props.interestId as string
  const [settings, setSettings] = useState<Settings | null>(null)
  const [link, setLink] = useState<Link | null>(null)
  const [tab, setTab] = useState<Tab>('overview')

  const [overview, setOverview] = useState<Overview | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [pulls, setPulls] = useState<Pull[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [selIssue, setSelIssue] = useState<number | null>(null)
  const [newIssue, setNewIssue] = useState(false)
  const [niTitle, setNiTitle] = useState('')
  const [niBody, setNiBody] = useState('')

  const init = useCallback(async () => {
    const s = await api.get<Settings>('/plugins/code-project/settings')
    setSettings(s)
    if (s.configured) setLink(await api.get<Link>(`/plugins/code-project/link/${interestId}`))
  }, [interestId])
  useEffect(() => { init() }, [init])

  const loadTab = useCallback(async (t: Tab) => {
    if (!link?.owner) return
    setLoading(true); setErr(null)
    const base = `/plugins/code-project`
    try {
      if (t === 'overview') setOverview(await api.get<Overview>(`${base}/overview/${interestId}`))
      if (t === 'issues') setIssues(await api.get<Issue[]>(`${base}/issues/${interestId}`))
      if (t === 'pulls') setPulls(await api.get<Pull[]>(`${base}/pulls/${interestId}`))
      if (t === 'activity') setCommits(await api.get<Commit[]>(`${base}/commits/${interestId}`))
    } catch (e) { setErr((e as Error).message) } finally { setLoading(false) }
  }, [interestId, link])

  useEffect(() => { if (link?.owner) loadTab(tab) }, [tab, link, loadTab])

  const resetToken = async () => { await api.del('/plugins/code-project/settings'); setSettings({ configured: false, login: null }); setLink(null) }
  const unlink = async () => { await api.del(`/plugins/code-project/link/${interestId}`); setLink({}) }
  const createIssue = async () => {
    if (!niTitle.trim()) return
    await api.post(`/plugins/code-project/issues/${interestId}`, { title: niTitle, body: niBody })
    setNewIssue(false); setNiTitle(''); setNiBody(''); loadTab('issues')
  }

  if (!settings) return <div className="text-text-3 text-sm">Loading…</div>
  if (!settings.configured) return <TokenSetup onSaved={(s) => { setSettings(s); init() }} />
  if (!link?.owner) return <RepoLink interestId={interestId} login={settings.login} onLinked={setLink} onReset={resetToken} />

  const TABS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', Icon: FileText },
    { id: 'issues', label: 'Issues', Icon: CircleDot },
    { id: 'pulls', label: 'Pull requests', Icon: GitPullRequest },
    { id: 'activity', label: 'Activity', Icon: GitCommit },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <Code2 size={15} /> {link.owner}/{link.repo}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => loadTab(tab)} className="btn-ghost p-1.5" title="Refresh"><RefreshCw size={14} /></button>
          <button onClick={unlink} className="btn-ghost p-1.5" title="Unlink repo"><Settings2 size={14} /></button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap border-b border-bg-3 pb-2">
        {TABS.map(({ id, label, Icon }) => (
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

      {tab === 'overview' && overview && (
        <div className="space-y-3">
          <div className="card p-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {overview.description && <span className="text-text-2 w-full">{overview.description}</span>}
            {overview.language && <span className="text-text-3">{overview.language}</span>}
            <span className="flex items-center gap-1 text-text-3"><Star size={13} /> {overview.stars}</span>
            <span className="flex items-center gap-1 text-text-3"><CircleDot size={13} /> {overview.open_issues} open</span>
            <span className="text-text-3">branch: {overview.default_branch}</span>
            <a href={overview.html_url} target="_blank" rel="noreferrer" className="ml-auto text-accent flex items-center gap-1">
              GitHub <ExternalLink size={13} />
            </a>
          </div>
          {overview.readme_html
            ? <div className="card p-5 gh-readme text-sm max-h-[28rem] overflow-y-auto"
                   dangerouslySetInnerHTML={{ __html: overview.readme_html }} />
            : <p className="text-sm text-text-3">No README.</p>}
        </div>
      )}

      {tab === 'issues' && (
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

      {tab === 'pulls' && !loading && (
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

      {tab === 'activity' && !loading && (
        <div className="card divide-y divide-bg-3">
          {commits.length === 0 ? <p className="text-sm text-text-3 p-4 text-center">No commits.</p> :
            commits.map((c) => (
              <a key={c.sha} href={c.html_url} target="_blank" rel="noreferrer" className="flex items-start gap-2 p-3 hover:bg-bg-2">
                <GitCommit size={15} className="text-text-3 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-1 truncate">{c.message}</div>
                  <div className="text-xs text-text-3">{c.author} · <code>{c.sha}</code> · {c.date ? new Date(c.date).toLocaleDateString() : ''}</div>
                </div>
              </a>
            ))}
        </div>
      )}
    </div>
  )
}
