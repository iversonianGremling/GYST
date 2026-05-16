import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid,
} from 'recharts'
import { api } from '@/api/client'

interface DomainRow   { domain: string; visits: number; total_duration: number }
interface HeatCell    { hour: number; dow: number; visits: number }
interface DailyRow    { date: string; visits: number; total_duration: number }
interface Summary     { total: number; by_source: Record<string, number> }

const DAYS  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function fmtHour(h: number) {
  if (h === 0) return '12a'
  if (h < 12) return `${h}a`
  if (h === 12) return '12p'
  return `${h - 12}p`
}

function fmtDuration(minutes: number) {
  if (minutes < 60) return `${Math.round(minutes)}m`
  return `${(minutes / 60).toFixed(1)}h`
}

export default function Telemetry() {
  const [domains,  setDomains]  = useState<DomainRow[]>([])
  const [heatmap,  setHeatmap]  = useState<HeatCell[]>([])
  const [daily,    setDaily]    = useState<DailyRow[]>([])
  const [summary,  setSummary]  = useState<Summary | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<DomainRow[]>('/telemetry/top-domains'),
      api.get<HeatCell[]>('/telemetry/heatmap'),
      api.get<DailyRow[]>('/telemetry/daily?days=30'),
      api.get<Summary>('/telemetry/summary'),
    ]).then(([d, h, dl, s]) => { setDomains(d); setHeatmap(h); setDaily(dl); setSummary(s) })
  }, [])

  // Build heatmap lookup: map[hour][dow] = visits
  const heatLookup: Record<number, Record<number, number>> = {}
  let heatMax = 1
  for (const cell of heatmap) {
    heatLookup[cell.hour] ??= {}
    heatLookup[cell.hour][cell.dow] = cell.visits
    if (cell.visits > heatMax) heatMax = cell.visits
  }

  const noData = !summary || summary.total === 0

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-8">
      <h1 className="text-xl font-semibold">Telemetry</h1>

      {noData ? (
        <div className="card p-8 text-center text-text-3">
          <p className="text-lg mb-1">No data yet.</p>
          <p className="text-xs">Set up browser history rsync or POST events to <code>/api/v1/telemetry/ingest</code>.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="card p-4">
                <p className="text-2xl font-semibold text-text-1">{summary.total.toLocaleString()}</p>
                <p className="text-xs text-text-3 mt-1">Total events</p>
              </div>
              {Object.entries(summary.by_source).map(([src, count]) => (
                <div key={src} className="card p-4">
                  <p className="text-2xl font-semibold text-text-1">{count.toLocaleString()}</p>
                  <p className="text-xs text-text-3 mt-1 capitalize">{src}</p>
                </div>
              ))}
            </div>
          )}

          {/* Daily trend */}
          {daily.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide mb-3">Daily activity (30 days)</h2>
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={daily} margin={{ left: -20 }}>
                  <CartesianGrid stroke="var(--color-bg-3)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--color-text-3)', fontSize: 10 }}
                    tickFormatter={(v: string) => v.slice(5)} // MM-DD
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fill: 'var(--color-text-3)', fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-bg-2)', border: '1px solid var(--color-bg-3)', borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number, name: string) => [
                      name === 'total_duration' ? fmtDuration(v) : v,
                      name === 'total_duration' ? 'Time' : 'Visits',
                    ]}
                  />
                  <Line type="monotone" dataKey="visits" stroke="var(--color-accent)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Time-of-day heatmap */}
          {heatmap.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide mb-3">Time of day</h2>
              <div className="overflow-x-auto">
                <div className="inline-grid gap-0.5" style={{ gridTemplateColumns: `40px repeat(24, minmax(0, 1fr))` }}>
                  {/* Header row */}
                  <div />
                  {HOURS.map((h) => (
                    <div key={h} className="text-center text-[9px] text-text-3 pb-0.5">
                      {h % 3 === 0 ? fmtHour(h) : ''}
                    </div>
                  ))}
                  {/* Day rows */}
                  {DAYS.map((day, dow) => (
                    <>
                      <div key={`label-${dow}`} className="text-[10px] text-text-3 flex items-center pr-1">{day}</div>
                      {HOURS.map((hour) => {
                        const visits = heatLookup[hour]?.[dow] ?? 0
                        const intensity = visits / heatMax
                        return (
                          <div
                            key={`${dow}-${hour}`}
                            title={`${day} ${fmtHour(hour)}: ${visits} visits`}
                            className="w-full aspect-square rounded-[2px]"
                            style={{
                              background: visits === 0
                                ? 'var(--color-bg-3)'
                                : `rgba(124, 106, 247, ${0.15 + intensity * 0.85})`,
                            }}
                          />
                        )
                      })}
                    </>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Top domains */}
          {domains.length > 0 && (
            <section>
              <h2 className="text-sm font-medium text-text-2 uppercase tracking-wide mb-3">Top domains</h2>
              <ResponsiveContainer width="100%" height={Math.min(domains.length * 28 + 20, 400)}>
                <BarChart data={domains} layout="vertical" margin={{ left: 0 }}>
                  <XAxis type="number" tick={{ fill: 'var(--color-text-3)', fontSize: 11 }} />
                  <YAxis
                    type="category"
                    dataKey="domain"
                    width={150}
                    tick={{ fill: 'var(--color-text-2)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-bg-2)', border: '1px solid var(--color-bg-3)', borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number, name: string) => [
                      name === 'total_duration' ? fmtDuration(v) : v,
                      name === 'total_duration' ? 'Time (min)' : 'Visits',
                    ]}
                  />
                  <Bar dataKey="visits" fill="var(--color-accent)" radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}
        </>
      )}
    </div>
  )
}
