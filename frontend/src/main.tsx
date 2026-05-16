import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { router } from './routes'
import { useSession } from './stores/session'
import { useTheme } from './stores/theme'
import { loadPlugins } from './plugins/registry'

function App() {
  const { check } = useSession()
  const { theme } = useTheme()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    check().then(() => loadPlugins().catch(() => {}))
  }, [check, theme])

  return <RouterProvider router={router} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
