import { useState } from 'react'
import { Smile } from 'lucide-react'

export default function HelloWorldWidget(_props: Record<string, unknown>) {
  const [msg, setMsg] = useState<string | null>(null)

  const ping = async () => {
    const res = await fetch('/api/v1/plugins/hello-world/hello', { credentials: 'include' })
    const data = await res.json()
    setMsg(data.message)
    setTimeout(() => setMsg(null), 3000)
  }

  return (
    <button
      className="sidebar-item w-full"
      onClick={ping}
      title={msg ?? 'Hello World plugin'}
    >
      <Smile size={17} strokeWidth={1.75} />
      {msg ? <span className="text-accent truncate text-xs">{msg}</span> : 'Hello Plugin'}
    </button>
  )
}
