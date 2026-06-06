import { useEffect, useState, type ComponentType } from 'react'
import type { Plugin } from '@/api/client'
import { getPluginsForSlot, getWidget } from './registry'

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
    const plugins = getPluginsForSlot(name).filter((p) => appliesTo(p, projectType))
    if (plugins.length === 0) { setWidgets([]); setLoaded(true); return }
    Promise.all(plugins.map((p) => getWidget(p.id)))
      .then((ws) => setWidgets(ws.filter(Boolean) as ComponentType<Record<string, unknown>>[]))
      .finally(() => setLoaded(true))
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
    const plugins = getPluginsForSlot(name).filter((p) => appliesTo(p, projectType))
    if (plugins.length === 0) { setState({ ready: true, count: 0 }); return }
    Promise.all(plugins.map((p) => getWidget(p.id)))
      .then((ws) => {
        const loaded = ws.filter(Boolean)
        setState({ ready: true, count: loaded.length })
      })
  }, [name, projectType])

  return state
}
