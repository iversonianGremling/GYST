import { useEffect, useState } from 'react'
import { Save, Plug, CheckCircle2, XCircle, Loader2, BookMarked } from 'lucide-react'

interface Config { base_url: string; api_key: string; configured: boolean }

export default function LinkwardenWidget(_props: Record<string, unknown>) {
  const [config,   setConfig]   = useState<Config>({ base_url: '', api_key: '', configured: false })
  const [editing,  setEditing]  = useState(false)
  const [baseUrl,  setBaseUrl]  = useState('')
  const [apiKey,   setApiKey]   = useState('')
  const [testing,  setTesting]  = useState(false)
  const [testMsg,  setTestMsg]  = useState<{ ok: boolean; text: string } | null>(null)
  const [saving,   setSaving]   = useState(false)

  const load = () =>
    fetch('/api/v1/plugins/linkwarden/settings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d: Config) => { setConfig(d); setBaseUrl(d.base_url); setApiKey(d.api_key) })
      .catch(() => {})

  useEffect(() => { load() }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await fetch('/api/v1/plugins/linkwarden/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
    })
    await load()
    setSaving(false)
    setEditing(false)
    setTestMsg(null)
  }

  const test = async () => {
    setTesting(true)
    setTestMsg(null)
    const d = await fetch('/api/v1/plugins/linkwarden/test', {
      method: 'POST',
      credentials: 'include',
    }).then((r) => r.json()).catch(() => ({ ok: false, error: 'Network error' }))
    setTestMsg(d.ok ? { ok: true, text: `Connected as ${d.user}` } : { ok: false, text: d.error ?? 'Failed' })
    setTesting(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <BookMarked size={16} className="text-accent" />
        <h3 className="text-sm font-medium text-text-2">Linkwarden</h3>
        {config.configured && !editing && (
          <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded ml-auto">configured</span>
        )}
      </div>

      {!editing && config.configured ? (
        <div className="space-y-3">
          <div className="card px-3 py-2.5 text-sm text-text-2 truncate">{config.base_url}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={test}
              disabled={testing}
              className="btn-ghost text-xs flex items-center gap-1.5"
            >
              {testing
                ? <Loader2 size={12} className="animate-spin" />
                : <Plug size={12} />}
              Test connection
            </button>
            <button onClick={() => setEditing(true)} className="btn-ghost text-xs">Edit</button>
            {testMsg && (
              <span className={`text-xs flex items-center gap-1 ${testMsg.ok ? 'text-green-400' : 'text-danger'}`}>
                {testMsg.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {testMsg.text}
              </span>
            )}
          </div>
          <p className="text-xs text-text-3">
            Bookmarks are imported as feed items on each scheduled fetch. Collections whose names match GYST interest titles are linked automatically.
          </p>
        </div>
      ) : (
        <form onSubmit={save} className="space-y-3 max-w-sm">
          <div>
            <label className="text-xs text-text-3 mb-1 block">Linkwarden base URL</label>
            <input
              className="input w-full text-sm"
              placeholder="https://linkwarden.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              type="url"
              required
            />
          </div>
          <div>
            <label className="text-xs text-text-3 mb-1 block">API key</label>
            <input
              className="input w-full text-sm font-mono"
              placeholder="your-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              autoComplete="off"
              required
            />
            <p className="text-[11px] text-text-3 mt-1">
              Generate in Linkwarden → Settings → Access Tokens
            </p>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-1.5 text-sm">
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
            {config.configured && (
              <button type="button" onClick={() => setEditing(false)} className="btn-ghost text-sm">Cancel</button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
