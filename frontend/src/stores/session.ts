import { create } from 'zustand'
import { api } from '@/api/client'

interface SessionState {
  authenticated: boolean
  loading: boolean
  check: () => Promise<void>
  logout: () => Promise<void>
}

export const useSession = create<SessionState>((set) => ({
  authenticated: false,
  loading: true,

  check: async () => {
    try {
      await api.get('/auth/me')
      set({ authenticated: true, loading: false })
    } catch {
      set({ authenticated: false, loading: false })
    }
  },

  logout: async () => {
    await api.post('/auth/logout')
    set({ authenticated: false })
    window.location.href = '/login'
  },
}))
