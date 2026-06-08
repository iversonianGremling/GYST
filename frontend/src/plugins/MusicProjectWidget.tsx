import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Music2, Music4, FileText, Sliders, Cpu, ExternalLink, Save } from 'lucide-react'
import { api, type MediaAsset } from '@/api/client'
import AudioPlayer from '@/components/AudioPlayer'
import DropZone from '@/components/DropZone'
import TabViewer from '@/components/TabViewer'
import SynthPad from '@/components/SynthPad'
import ScoreList from '@/components/music/ScoreList'

type Tab = 'lyrics' | 'compose' | 'samples' | 'tabs' | 'synth' | 'settings'

function TabFileList({ files }: { files: MediaAsset[] }) {
  const [active, setActive] = useState(files[0]?.id ?? null)
  const current = files.find((f) => f.id === active)

  return (
    <div className="space-y-3">
      {files.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {files.map((f) => (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                active === f.id ? 'border-accent text-accent bg-accent/10' : 'border-bg-3 text-text-2 hover:border-accent/50'
              }`}
            >
              {f.original_name}
            </button>
          ))}
        </div>
      )}
      {current && (
        <TabViewer src={current.url} title={current.original_name} />
      )}
    </div>
  )
}

const KEYS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B',
               'Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m','Am','A#m','Bm']
const TIME_SIGS = ['4/4','3/4','6/8','12/8','5/4','7/8','2/4']

interface Settings { bpm: number; key: string; time_signature: string }
interface LyricsNote { id: string; title: string; body_md: string; updated_at: string }

export default function MusicProjectWidget(props: Record<string, unknown>) {
  const interestId = props.interestId as string
  const navigate = useNavigate()

  const [tab, setTab] = useState<Tab>('lyrics')
  const [lyrics, setLyrics] = useState<LyricsNote | null>(null)
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [settings, setSettings] = useState<Settings>({ bpm: 120, key: 'C', time_signature: '4/4' })
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  const loadMedia = useCallback(() => {
    api.get<MediaAsset[]>(`/media?interest_id=${interestId}`).then(setMedia)
  }, [interestId])

  useEffect(() => {
    api.get<LyricsNote>(`/plugins/music-project/lyrics/${interestId}`).then(setLyrics)
    api.get<Settings>(`/plugins/music-project/settings/${interestId}`).then(setSettings)
    loadMedia()
  }, [interestId, loadMedia])

  const saveSettings = async () => {
    setSavingSettings(true)
    await fetch(`/api/v1/plugins/music-project/settings/${interestId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    setSavingSettings(false)
    setSettingsDirty(false)
  }

  const audios = media.filter((m) => m.kind === 'audio')
  const tabFiles = media.filter((m) => m.kind === 'tab' || m.kind === 'midi')

  const TAB_ITEMS: { id: Tab; label: string; Icon: React.ElementType }[] = [
    { id: 'lyrics',   label: 'Lyrics',   Icon: FileText },
    { id: 'compose',  label: 'Compose',  Icon: Music4 },
    { id: 'samples',  label: 'Samples',  Icon: Music2 },
    { id: 'tabs',     label: 'Tabs',     Icon: FileText },
    { id: 'synth',    label: 'Synth',    Icon: Cpu },
    { id: 'settings', label: 'Settings', Icon: Sliders },
  ]

  return (
    <div className="space-y-4">
      {/* Settings strip */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-text-3">
        <span className="font-medium text-text-2">{settings.key}</span>
        <span>{settings.bpm} BPM</span>
        <span>{settings.time_signature}</span>
        <button className="text-accent hover:underline ml-auto" onClick={() => setTab('settings')}>
          Edit
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="tab-strip gap-0.5 border-b border-bg-3">
        {TAB_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-b-2 -mb-px ${
              tab === id ? 'border-accent text-accent' : 'border-transparent text-text-2 hover:text-text-1'
            }`}
          >
            <Icon size={12} />{label}
          </button>
        ))}
      </div>

      {/* Lyrics */}
      {tab === 'lyrics' && lyrics && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-3">Dedicated lyrics note for this project.</p>
            <button
              className="btn-primary text-xs flex items-center gap-1.5"
              onClick={() => navigate(`/notes/${lyrics.id}`)}
            >
              <ExternalLink size={12} /> Open editor
            </button>
          </div>
          {lyrics.body_md ? (
            <pre className="text-sm text-text-2 bg-bg-3 rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
              {lyrics.body_md.slice(0, 800)}{lyrics.body_md.length > 800 ? '\n…' : ''}
            </pre>
          ) : (
            <p className="text-sm text-text-3 italic">No lyrics yet — open the editor to write some.</p>
          )}
        </div>
      )}

      {/* Compose — piano-roll / MIDI writer */}
      {tab === 'compose' && <ScoreList interestId={interestId} />}

      {/* Samples */}
      {tab === 'samples' && (
        <div className="space-y-4">
          <DropZone interestId={interestId} onUploaded={loadMedia} accept="audio/*" />
          {audios.length === 0 ? (
            <p className="text-sm text-text-3">No audio samples yet.</p>
          ) : (
            <div className="space-y-2">
              {audios.map((a) => (
                <AudioPlayer key={a.id} src={a.url} title={a.original_name} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      {tab === 'tabs' && (
        <div className="space-y-4">
          <DropZone
            interestId={interestId}
            onUploaded={loadMedia}
            accept=".gp,.gp5,.gp4,.gpx,.musicxml,.xml,.mid,.midi"
          />
          {tabFiles.length === 0 ? (
            <p className="text-sm text-text-3">No tab files yet. Upload .gp, .gpx, or .musicxml files.</p>
          ) : (
            <TabFileList files={tabFiles} />
          )}
        </div>
      )}

      {/* Synth */}
      {tab === 'synth' && <SynthPad />}

      {/* Settings */}
      {tab === 'settings' && (
        <div className="space-y-4 max-w-xs">
          <div>
            <label className="text-xs text-text-3 mb-1 block">BPM</label>
            <input
              type="number"
              min={20} max={300}
              className="input w-full"
              value={settings.bpm}
              onChange={(e) => { setSettings({ ...settings, bpm: Number(e.target.value) }); setSettingsDirty(true) }}
            />
          </div>
          <div>
            <label className="text-xs text-text-3 mb-1 block">Key</label>
            <select
              className="input w-full"
              value={settings.key}
              onChange={(e) => { setSettings({ ...settings, key: e.target.value }); setSettingsDirty(true) }}
            >
              {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-text-3 mb-1 block">Time signature</label>
            <select
              className="input w-full"
              value={settings.time_signature}
              onChange={(e) => { setSettings({ ...settings, time_signature: e.target.value }); setSettingsDirty(true) }}
            >
              {TIME_SIGS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <button
            className="btn-primary flex items-center gap-1.5"
            onClick={saveSettings}
            disabled={!settingsDirty || savingSettings}
          >
            <Save size={13} />{savingSettings ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
