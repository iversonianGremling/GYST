import { useEffect, useState, type ComponentType } from 'react'
import type { Plugin } from '@/api/client'
import { ensurePluginsLoaded, getPluginsForSlot, getWidget } from './registry'

interface PluginSlotProps {
  name: string
  [key: string]: unknown
}

/** A plugin with no `project_types` applies everywhere; otherwise its widget
 *  only renders for matching Project.type values. When the caller doesn't pass
 *  a projectType (non-project slots), no type filtering happens. */
function appliesTo(p: Plugin, projectType?: string): boolean {
  if (!p.project_types || p.project_types.length === 0) return true
  if (projectType === undefined) return true
  return p.project_types.includes(projectType)
}

export function PluginSlot({ name, ...props }: PluginSlotProps) {
  const projectType = props.projectType as string | undefined
  const [widgets, setWidgets] = useState<ComponentType<Record<string, unknown>>[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Wait for the plugin registry before reading it — the slot may render
    // before loadPlugins() resolves (e.g. project loads faster than /plugins).
    ensurePluginsLoaded()
      .then(() => {
        if (cancelled) return
        const plugins = getPluginsForSlot(name).filter((p) => appliesTo(p, projectType))
        if (plugins.length === 0) { setWidgets([]); return }
        return Promise.all(plugins.map((p) => getWidget(p.id)))
          .then((ws) => { if (!cancelled) setWidgets(ws.filter(Boolean) as ComponentType<Record<string, unknown>>[]) })
      })
      .catch(() => { if (!cancelled) setWidgets([]) })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [name, projectType])

  if (!loaded) return null

  return (
    <>
      {widgets.map((Widget, i) => (
        <Widget key={i} {...props} />
      ))}
    </>
  )
}

/** Returns true once the named slot has resolved (useful for showing tab buttons).
 *  Pass projectType to mirror PluginSlot's type filtering so the tab only shows
 *  when a widget actually applies. */
export function usePluginSlotReady(name: string, projectType?: string): { ready: boolean; count: number } {
  const [state, setState] = useState({ ready: false, count: 0 })

  useEffect(() => {
    let cancelled = false
    ensurePluginsLoaded()
      .then(() => {
        if (cancelled) return
        const plugins = getPluginsForSlot(name).filter((p) => appliesTo(p, projectType))
        if (plugins.length === 0) { setState({ ready: true, count: 0 }); return }
        return Promise.all(plugins.map((p) => getWidget(p.id)))
          .then((ws) => { if (!cancelled) setState({ ready: true, count: ws.filter(Boolean).length }) })
      })
      .catch(() => { if (!cancelled) setState({ ready: true, count: 0 }) })
    return () => { cancelled = true }
  }, [name, projectType])

  return state
}
