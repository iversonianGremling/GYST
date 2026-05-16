import { useEffect, useState } from 'react'
import { api, type Plugin } from '@/api/client'
import { PluginSlot } from '@/plugins/slots'

export default function Settings() {
  const [plugins, setPlugins] = useState<Plugin[]>([])

  useEffect(() => {
    api.get<Plugin[]>('/plugins').then(setPlugins)
  }, [])

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-10">
      <h1 className="text-xl font-semibold">Settings</h1>

      {/* RSS / Feed sources */}
      <section className="card p-5">
        <PluginSlot name="settings.feeds" />
      </section>

      {/* Integrations (Linkwarden, etc.) */}
      <section>
        <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide mb-3">Integrations</h2>
        <div className="card p-5">
          <PluginSlot name="settings.integrations" />
        </div>
      </section>

      {/* Plugins */}
      <section>
        <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide mb-3">Loaded plugins</h2>
        {plugins.length === 0 ? (
          <p className="text-sm text-text-3">No plugins loaded. Add plugin folders to the plugins/ directory.</p>
        ) : (
          <div className="space-y-2">
            {plugins.map((p) => (
              <div key={p.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-text-1">{p.name}</span>
                    <span className="text-xs text-text-3 ml-2">v{p.version}</span>
                  </div>
                  <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">active</span>
                </div>
                {p.hooks.length > 0 && (
                  <p className="text-xs text-text-3 mt-1">Hooks: {p.hooks.join(', ')}</p>
                )}
                {p.ui_slots.length > 0 && (
                  <p className="text-xs text-text-3">Slots: {p.ui_slots.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
