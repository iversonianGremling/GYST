import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { copyFileSync } from 'fs'

// Copy alphaTab worker to public/ so it's served as a static asset.
// Must run before build so the file is available during dev and prod.
try {
  copyFileSync(
    'node_modules/@coderline/alphatab/dist/alphaTab.worker.mjs',
    'public/alphaTab.worker.mjs',
  )
} catch { /* first run before node_modules */ }

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  // alphaTab uses SharedArrayBuffer for audio; requires COOP/COEP headers.
  // In dev, Vite can inject them. In prod, Caddy sets them.
  optimizeDeps: {
    exclude: ['@coderline/alphatab'],
  },
})
