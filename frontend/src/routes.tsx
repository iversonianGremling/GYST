import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import Layout from '@/components/Layout'
import Login from '@/pages/Login'

const Home           = lazy(() => import('@/pages/Home'))
const Projects       = lazy(() => import('@/pages/Projects'))
const Interests      = lazy(() => import('@/pages/Interests'))
const InterestDetail = lazy(() => import('@/pages/InterestDetail'))
const Notes          = lazy(() => import('@/pages/Notes'))
const NoteEditor     = lazy(() => import('@/pages/NoteEditor'))
const Calendar       = lazy(() => import('@/pages/Calendar'))
const Feed           = lazy(() => import('@/pages/Feed'))
const Telemetry      = lazy(() => import('@/pages/Telemetry'))
const Settings       = lazy(() => import('@/pages/Settings'))
const Sync           = lazy(() => import('@/pages/Sync'))

function Wrap({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="p-6 text-text-3">Loading…</div>}>{children}</Suspense>
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true,                element: <Wrap><Home /></Wrap> },
      
      { path: 'projects',           element: <Wrap><Projects /></Wrap> },
      { path: 'interests',          element: <Wrap><Interests /></Wrap> },
      { path: 'interests/:id',      element: <Wrap><InterestDetail /></Wrap> },
      { path: 'notes',              element: <Wrap><Notes /></Wrap> },
      { path: 'notes/:id',          element: <Wrap><NoteEditor /></Wrap> },
      { path: 'calendar',           element: <Wrap><Calendar /></Wrap> },
      { path: 'feed',               element: <Wrap><Feed /></Wrap> },
      { path: 'telemetry',          element: <Wrap><Telemetry /></Wrap> },
      { path: 'sync',               element: <Wrap><Sync /></Wrap> },
      { path: 'settings',           element: <Wrap><Settings /></Wrap> },
    ],
  },
])
