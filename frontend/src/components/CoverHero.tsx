import { useRef, useState } from 'react'
import { ImagePlus, X, ChevronDown, ChevronUp } from 'lucide-react'

export interface CoverSettings {
  blur:            number   // 0–20
  brightness:      number   // 0.3–1.5
  overlay_color:   string   // hex
  overlay_opacity: number   // 0–0.85
  position:        string   // CSS object-position
  scale:           number   // 1.0–1.5
}

export const DEFAULT_COVER_SETTINGS: CoverSettings = {
  blur:            0,
  brightness:      0.8,
  overlay_color:   '#000000',
  overlay_opacity: 0.45,
  position:        'center',
  scale:           1.05,
}

const POSITIONS = [
  ['left top',    'center top',    'right top'   ],
  ['left center', 'center',        'right center'],
  ['left bottom', 'center bottom', 'right bottom'],
]

// Derive a deterministic gradient hue from the interest title
function titleHue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) & 0xffff
  return h % 360
}

interface Props {
  title:          string
  coverUrl:       string | null
  settings:       CoverSettings
  editable?:      boolean
  onUpload?:      (file: File) => Promise<void>
  onSettingsChange?: (s: CoverSettings) => void
}

export default function CoverHero({
  title, coverUrl, settings, editable = false, onUpload, onSettingsChange,
}: Props) {
  const [editing,   setEditing]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const hue = titleHue(title)
  const fallbackGradient = `linear-gradient(135deg, hsl(${hue},35%,14%) 0%, hsl(${(hue + 40) % 360},25%,8%) 100%)`

  const imgStyle: React.CSSProperties = {
    filter:    `blur(${settings.blur}px) brightness(${settings.brightness})`,
    transform: `scale(${settings.scale})`,
    objectPosition: settings.position,
  }

  const set = (patch: Partial<CoverSettings>) => onSettingsChange?.({ ...settings, ...patch })

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !onUpload) return
    setUploading(true)
    await onUpload(file)
    setUploading(false)
  }

  return (
    <div className="space-y-0">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl" style={{ height: 220 }}>
        {/* Background */}
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-all duration-300"
            style={imgStyle}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: fallbackGradient }} />
        )}

        {/* Color overlay */}
        <div
          className="absolute inset-0 transition-all duration-300"
          style={{ background: settings.overlay_color, opacity: settings.overlay_opacity }}
        />

        {/* Bottom gradient fade to page background */}
        <div className="absolute inset-0" style={{
          background: 'linear-gradient(to bottom, transparent 35%, var(--color-bg-1) 100%)',
        }} />

        {/* Title / description */}
        <div className="absolute bottom-0 left-0 right-0 px-6 pb-4">
          <h1 className="text-2xl font-semibold text-white drop-shadow">{title}</h1>
        </div>

        {/* Edit button */}
        {editable && (
          <button
            onClick={() => setEditing((v) => !v)}
            className="absolute top-3 right-3 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-bg-1/70 backdrop-blur-sm text-text-2 hover:text-text-1 hover:bg-bg-1/90 transition-all"
          >
            <ImagePlus size={12} />
            {editing ? 'Done' : 'Edit cover'}
            {editing ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}

        {/* Upload overlay */}
        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-1/60 backdrop-blur-sm">
            <span className="text-sm text-text-2 animate-pulse">Uploading…</span>
          </div>
        )}
      </div>

      {/* Settings panel */}
      {editing && editable && (
        <div className="border border-bg-3 rounded-b-xl bg-bg-2 px-5 py-4 space-y-4 -mt-1">
          {/* Upload */}
          <div className="flex items-center gap-3">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
            <button
              onClick={() => fileRef.current?.click()}
              className="btn-ghost text-xs flex items-center gap-1.5"
            >
              <ImagePlus size={13} /> Upload image
            </button>
            {coverUrl && (
              <button
                onClick={() => set({ ...settings })}
                className="text-xs text-text-3 hover:text-danger flex items-center gap-1"
              >
                <X size={11} /> Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            {/* Blur */}
            <label className="space-y-1">
              <span className="text-xs text-text-3 flex justify-between">
                <span>Blur</span><span>{settings.blur}px</span>
              </span>
              <input type="range" min={0} max={20} step={1} value={settings.blur}
                onChange={(e) => set({ blur: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]" />
            </label>

            {/* Brightness */}
            <label className="space-y-1">
              <span className="text-xs text-text-3 flex justify-between">
                <span>Brightness</span><span>{settings.brightness.toFixed(1)}</span>
              </span>
              <input type="range" min={0.3} max={1.5} step={0.05} value={settings.brightness}
                onChange={(e) => set({ brightness: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]" />
            </label>

            {/* Overlay opacity */}
            <label className="space-y-1">
              <span className="text-xs text-text-3 flex justify-between">
                <span>Overlay</span><span>{Math.round(settings.overlay_opacity * 100)}%</span>
              </span>
              <input type="range" min={0} max={0.85} step={0.05} value={settings.overlay_opacity}
                onChange={(e) => set({ overlay_opacity: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]" />
            </label>

            {/* Scale */}
            <label className="space-y-1">
              <span className="text-xs text-text-3 flex justify-between">
                <span>Zoom</span><span>{settings.scale.toFixed(2)}×</span>
              </span>
              <input type="range" min={1} max={1.5} step={0.01} value={settings.scale}
                onChange={(e) => set({ scale: Number(e.target.value) })}
                className="w-full accent-[var(--color-accent)]" />
            </label>
          </div>

          {/* Overlay color + position grid side by side */}
          <div className="flex items-start gap-6">
            <label className="space-y-1">
              <span className="text-xs text-text-3 block">Tint color</span>
              <input
                type="color"
                value={settings.overlay_color}
                onChange={(e) => set({ overlay_color: e.target.value })}
                className="w-10 h-8 rounded border border-bg-3 cursor-pointer bg-transparent p-0.5"
              />
            </label>

            {/* 3×3 position picker */}
            <div className="space-y-1">
              <span className="text-xs text-text-3 block">Position</span>
              <div className="grid grid-cols-3 gap-1 p-1.5 bg-bg-3 rounded-lg w-fit">
                {POSITIONS.map((row) =>
                  row.map((pos) => (
                    <button
                      key={pos}
                      onClick={() => set({ position: pos })}
                      title={pos}
                      className={`w-5 h-5 rounded transition-colors ${
                        settings.position === pos
                          ? 'bg-accent'
                          : 'bg-bg-4 hover:bg-accent/40'
                      }`}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
