import { create } from 'zustand'

interface LayoutState {
  sidebarOpen: boolean
  toggle: () => void
  close: () => void
}

export const useLayout = create<LayoutState>((set) => ({
  sidebarOpen: false,
  toggle: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  close: () => set({ sidebarOpen: false }),
}))
