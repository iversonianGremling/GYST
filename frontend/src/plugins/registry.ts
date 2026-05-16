import type { ComponentType } from 'react'
import { api, type Plugin } from '@/api/client'
import { STATIC_WIDGETS } from './widgets'

interface WidgetModule {
  default: ComponentType<Record<string, unknown>>
}

let _plugins: Plugin[] = []
const _widgetCache = new Map<string, ComponentType<Record<string, unknown>>>()

export async function loadPlugins(): Promise<Plugin[]> {
  _plugins = await api.get<Plugin[]>('/plugins')
  return _plugins
}

export function getPlugins(): Plugin[] {
  return _plugins
}

export function getPluginsForSlot(slot: string): Plugin[] {
  return _plugins.filter((p) => p.ui_slots.includes(slot))
}

export async function getWidget(pluginId: string): Promise<ComponentType<Record<string, unknown>> | null> {
  if (_widgetCache.has(pluginId)) return _widgetCache.get(pluginId)!

  // Static (bundled) registry takes priority
  if (STATIC_WIDGETS[pluginId]) {
    _widgetCache.set(pluginId, STATIC_WIDGETS[pluginId])
    return STATIC_WIDGETS[pluginId]
  }

  // Fall back to dynamic ESM served by the backend (out-of-tree plugins with their own build)
  const plugin = _plugins.find((p) => p.id === pluginId)
  if (!plugin?.widget) return null
  try {
    const mod = await import(/* @vite-ignore */ `/api/v1/plugins/${pluginId}/widget`) as WidgetModule
    _widgetCache.set(pluginId, mod.default)
    return mod.default
  } catch {
    return null
  }
}
