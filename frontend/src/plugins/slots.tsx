import { useEffect, useState, type ComponentType } from 'react'
import { getPluginsForSlot, getWidget } from './registry'

interface PluginSlotProps {
  name: string
  [key: string]: unknown
}

export function PluginSlot({ name, ...props }: PluginSlotProps) {
  const [widgets, setWidgets] = useState<ComponentType<Record<string, unknown>>[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const plugins = getPluginsForSlot(name)
    if (plugins.length === 0) { setLoaded(true); return }
    Promise.all(plugins.map((p) => getWidget(p.id)))
      .then((ws) => setWidgets(ws.filter(Boolean) as ComponentType<Record<string, unknown>>[]))
      .finally(() => setLoaded(true))
  }, [name])

  if (!loaded) return null

  return (
    <>
      {widgets.map((Widget, i) => (
        <Widget key={i} {...props} />
      ))}
    </>
  )
}

/** Returns true once the named slot has resolved (useful for showing tab buttons). */
export function usePluginSlotReady(name: string): { ready: boolean; count: number } {
  const [state, setState] = useState({ ready: false, count: 0 })

  useEffect(() => {
    const plugins = getPluginsForSlot(name)
    if (plugins.length === 0) { setState({ ready: true, count: 0 }); return }
    Promise.all(plugins.map((p) => getWidget(p.id)))
      .then((ws) => {
        const loaded = ws.filter(Boolean)
        setState({ ready: true, count: loaded.length })
      })
  }, [name])

  return state
}
