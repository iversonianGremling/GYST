import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import {
  Home, Star, FileText, Calendar, Rss, Activity,
  Settings, Sun, Moon, LogOut, Menu, X,
} from 'lucide-react'
import { useSession } from '@/stores/session'
import { useTheme } from '@/stores/theme'
import { useLayout } from '@/stores/layout'
import { PluginSlot } from '@/plugins/slots'

const NAV = [
  { to: '/',          label: 'Home',      Icon: Home },
  { to: '/interests', label: 'Interests', Icon: Star },
  { to: '/notes',     label: 'Notes',     Icon: FileText },
  { to: '/calendar',  label: 'Calendar',  Icon: Calendar },
  { to: '/feed',      label: 'Feed',      Icon: Rss },
  { to: '/telemetry', label: 'Telemetry', Icon: Activity },
  { to: '/settings',  label: 'Settings',  Icon: Settings },
]

export default function Layout() {
  const { logout } = useSession()
  const { toggle: toggleTheme, theme } = useTheme()
  const { sidebarOpen, toggle: toggleSidebar, close: closeSidebar } = useLayout()
  const location = useLocation()

  // Close sidebar on navigation (mobile)
  useEffect(() => { closeSidebar() }, [location.pathname, closeSidebar])

  const sidebar = (
    <aside className="flex flex-col h-full border-r border-bg-3 bg-bg-2" style={{ width: 'var(--sidebar-width)' }}>
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-bg-3">
        <span className="font-semibold text-text-1 tracking-tight">GYST</span>
        <span className="text-xs text-text-3 ml-auto">0.1</span>
        {/* Close button — mobile only */}
        <button
          className="md:hidden ml-1 p-1 rounded hover:bg-bg-3 text-text-2"
          onClick={closeSidebar}
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `sidebar-item${isActive ? ' active' : ''}`}
          >
            <Icon size={17} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
        <PluginSlot name="sidebar.nav" />
      </nav>

      {/* Bottom */}
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

      {/* ── Desktop sidebar (always visible) ── */}
      <div className="hidden md:flex shrink-0">
        {sidebar}
      </div>

      {/* ── Mobile sidebar (overlay) ── */}
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-30 bg-black/50 transition-opacity duration-200 ${
          sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeSidebar}
      />
      {/* Drawer */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 z-40 flex transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebar}
      </div>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 h-12 border-b border-bg-3 bg-bg-2 shrink-0">
          <button
            className="p-1.5 rounded hover:bg-bg-3 text-text-2"
            onClick={toggleSidebar}
            aria-label="Open menu"
          >
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
