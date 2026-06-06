import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Home, Layers, FolderKanban, FileText, Calendar, Rss, Activity,
  Settings, Sun, Moon, LogOut, Menu, X, GitMerge,
} from 'lucide-react'
import { api } from '@/api/client'
import { useSession } from '@/stores/session'
import { useTheme } from '@/stores/theme'
import { useLayout } from '@/stores/layout'
import { PluginSlot } from '@/plugins/slots'
import SidebarFolderSection from '@/components/SidebarFolderSection'

const FOLDER_SECTIONS = ['/interests', '/projects', '/notes'] as const
type FolderPath = typeof FOLDER_SECTIONS[number]

function SyncNavItem() {
  const [conflicts, setConflicts] = useState(0)
  useEffect(() => {
    let alive = true
    const tick = () => api.get<{ open_conflicts: number }>('/sync/status')
      .then((s) => { if (alive) setConflicts(s.open_conflicts) }).catch(() => {})
    tick()
    const id = setInterval(tick, 30000)
    return () => { alive = false; clearInterval(id) }
  }, [])
  return (
    <NavLink to="/sync" className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}>
      <GitMerge size={17} strokeWidth={1.75} />
      Sync
      {conflicts > 0 && (
        <span className="ml-auto text-xs px-1.5 rounded-full bg-amber-500/20 text-amber-400">{conflicts}</span>
      )}
    </NavLink>
  )
}

const SIMPLE_NAV = [
  { to: '/calendar',  label: 'Calendar',  Icon: Calendar },
  { to: '/feed',      label: 'Feed',      Icon: Rss },
  { to: '/telemetry', label: 'Telemetry', Icon: Activity },
  { to: '/settings',  label: 'Settings',  Icon: Settings },
]

function activeSection(pathname: string): FolderPath | null {
  // /interests/:id serves both interests and projects — don't auto-open from detail pages
  if (/^\/interests\/[^/]+$/.test(pathname)) return null
  return FOLDER_SECTIONS.find((p) => pathname === p || pathname.startsWith(p + '/')) ?? null
}

export default function Layout() {
  const { logout } = useSession()
  const { toggle: toggleTheme, theme } = useTheme()
  const { sidebarOpen, toggle: toggleSidebar, close: closeSidebar } = useLayout()
  const location = useLocation()

  const [openSection, setOpenSection] = useState<FolderPath | null>(
    activeSection(location.pathname)
  )

  useEffect(() => {
    const section = activeSection(location.pathname)
    if (section) setOpenSection(section)
  }, [location.pathname])

  useEffect(() => { closeSidebar() }, [location.pathname, closeSidebar])

  const toggle = (path: FolderPath) =>
    setOpenSection((prev) => (prev === path ? null : path))

  const sidebar = (
    <aside className="flex flex-col h-full border-r border-bg-3 bg-bg-2" style={{ width: 'var(--sidebar-width)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-3">
        <span className="font-semibold text-text-1 tracking-tight">GYST</span>
        <span className="text-xs text-text-3 ml-auto">0.1</span>
        <button className="md:hidden ml-1 p-1 rounded hover:bg-bg-3 text-text-2" onClick={closeSidebar} aria-label="Close menu">
          <X size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <NavLink to="/" end className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}>
          <Home size={17} strokeWidth={1.75} />
          Home
        </NavLink>

        <SidebarFolderSection
          path="/interests" label="Interests" Icon={Layers} entityType="content"
          open={openSection === '/interests'} onToggle={() => toggle('/interests')}
          itemsApiPath="/interests?kind=content&archived=false"
          itemLink={(id) => `/interests/${id}`}
        />
        <SidebarFolderSection
          path="/projects" label="Projects" Icon={FolderKanban} entityType="project"
          open={openSection === '/projects'} onToggle={() => toggle('/projects')}
          itemsApiPath="/interests?kind=project&archived=false"
          itemLink={(id) => `/interests/${id}`}
        />
        <SidebarFolderSection
          path="/notes" label="Notes" Icon={FileText} entityType="note"
          open={openSection === '/notes'} onToggle={() => toggle('/notes')}
          itemsApiPath="/notes"
          itemLink={(id) => `/notes/${id}`}
        />

        {SIMPLE_NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}>
            <Icon size={17} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}

        <SyncNavItem />

        <PluginSlot name="sidebar.nav" />
      </nav>

      <div className="p-2 border-t border-bg-3 space-y-0.5">
        <button className="sidebar-item w-full" onClick={toggleTheme}>
          {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
        <button
          className="sidebar-item w-full"
          style={{ color: 'var(--color-danger)' }}
          onMouseEnter={(e) => { const el = e.currentTarget; el.style.background = 'rgba(224,92,108,0.12)'; el.style.color = 'var(--color-danger)' }}
          onMouseLeave={(e) => { const el = e.currentTarget; el.style.background = ''; el.style.color = 'var(--color-danger)' }}
          onClick={logout}
        >
          <LogOut size={17} strokeWidth={1.75} />
          Log out
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:flex shrink-0">{sidebar}</div>

      <div className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ${sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`} onClick={closeSidebar} />
      <div className={`md:hidden fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>{sidebar}</div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-bg-3 bg-bg-2 shrink-0">
          <button className="p-1.5 rounded hover:bg-bg-3 text-text-2" onClick={toggleSidebar} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <span className="font-semibold text-text-1 tracking-tight text-sm">GYST</span>
        </header>
        <main className="flex-1 overflow-y-auto bg-bg-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
