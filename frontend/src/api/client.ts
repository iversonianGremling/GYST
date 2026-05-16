const BASE = '/api/v1'

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  })
  if (res.status === 401) {
    window.location.href = '/login'
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }))
    throw new ApiError(res.status, body.detail ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (path: string) => request<void>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, formData: FormData): Promise<T> => {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    if (!res.ok) throw new ApiError(res.status, res.statusText)
    return res.json()
  },
}

// Typed helpers
export interface CoverSettings {
  blur: number
  brightness: number
  overlay_color: string
  overlay_opacity: number
  position: string
  scale: number
}

export interface Interest {
  id: string
  kind: 'content' | 'project'
  title: string
  slug: string
  description: string | null
  cover_path: string | null
  cover_settings: CoverSettings | null
  folder_id: string | null
  archived: boolean
  created_at: string
  updated_at: string
}

export interface Project {
  interest_id: string
  type: 'music' | 'research' | 'code' | 'generic'
  status: string
  settings: Record<string, unknown>
}

export interface Folder {
  id: string
  name: string
  parent_id: string | null
  entity_type: string
  color: string | null
  position: number
  created_at: string
}

export interface Note {
  id: string
  interest_id: string | null
  folder_id: string | null
  title: string
  slug: string
  description: string | null
  cover_path: string | null
  cover_settings: CoverSettings | null
  pinned: boolean
  body_md: string
  created_at: string
  updated_at: string
}

export interface CalendarEvent {
  id: string
  interest_id: string | null
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  rrule: string | null
  body_md: string
  color: string | null
  created_at: string
}

export interface MediaAsset {
  id: string
  interest_id: string | null
  kind: string
  original_name: string
  mime: string
  duration_s: number | null
  meta: Record<string, unknown>
  created_at: string
  url: string
}

export interface FeedItem {
  id: string
  interest_id: string | null
  source_plugin: string
  title: string
  url: string | null
  payload: Record<string, unknown>
  fetched_at: string
  seen_at: string | null
  score: number
  score_breakdown: Record<string, unknown>
}

export interface Tag {
  id: number
  name: string
}

export interface Plugin {
  id: string
  name: string
  version: string
  hooks: string[]
  ui_slots: string[]
  widget: string | null
}
