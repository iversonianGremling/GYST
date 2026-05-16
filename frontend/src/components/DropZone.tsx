import { useRef, useState, useCallback, DragEvent } from 'react'
import { Upload, Loader2, CheckCircle2, XCircle } from 'lucide-react'

interface FileStatus {
  name: string
  state: 'uploading' | 'done' | 'error'
}

interface Props {
  interestId?: string
  onUploaded?: () => void
  accept?: string
}

export default function DropZone({ interestId, onUploaded, accept }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [queue, setQueue] = useState<FileStatus[]>([])

  const uploadFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return

    const list = Array.from(files)
    setQueue(list.map((f) => ({ name: f.name, state: 'uploading' })))

    await Promise.all(list.map(async (file, i) => {
      const fd = new FormData()
      fd.append('file', file)
      if (interestId) fd.append('interest_id', interestId)

      try {
        const res = await fetch('/api/v1/media', {
          method: 'POST',
          credentials: 'include',
          body: fd,
        })
        setQueue((q) => q.map((s, j) => j === i ? { ...s, state: res.ok ? 'done' : 'error' } : s))
      } catch {
        setQueue((q) => q.map((s, j) => j === i ? { ...s, state: 'error' } : s))
      }
    }))

    onUploaded?.()
    setTimeout(() => setQueue([]), 2500)
  }, [interestId, onUploaded])

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    uploadFiles(e.dataTransfer.files)
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to upload"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={`border-2 border-dashed rounded-lg p-8 flex flex-col items-center gap-2 cursor-pointer transition-colors select-none
          ${over ? 'border-accent bg-accent/10' : 'border-bg-4 hover:border-accent/50 hover:bg-bg-3/50'}`}
      >
        <Upload size={22} className={over ? 'text-accent' : 'text-text-3'} />
        <p className="text-sm text-text-2">Drop files here or <span className="text-accent">click to browse</span></p>
        <p className="text-xs text-text-3">Audio, images, MIDI, tabs, any file</p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        onChange={(e) => uploadFiles(e.target.files)}
      />

      {queue.length > 0 && (
        <div className="space-y-1">
          {queue.map((f, i) => (
            <div key={i} className="flex items-center gap-2 text-sm px-1">
              {f.state === 'uploading' && <Loader2 size={14} className="animate-spin text-accent shrink-0" />}
              {f.state === 'done'      && <CheckCircle2 size={14} className="text-green-400 shrink-0" />}
              {f.state === 'error'     && <XCircle size={14} className="text-danger shrink-0" />}
              <span className="truncate text-text-2">{f.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
