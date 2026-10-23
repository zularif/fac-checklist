import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // `npm run dev` serves the UI; API calls are proxied to `npm run dev:api` (wrangler dev).
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/files': 'http://127.0.0.1:8787',
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png'],
      manifest: {
        name: 'Facility Maintenance Checklist',
        short_name: 'Maintenance',
        description: 'QR-based equipment inspection checklist',
        theme_color: '#1a56db',
        background_color: '#1a56db',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell caching only — data always comes live from the Worker API,
        // keeping the offline queue (not the SW) responsible for data sync.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallbackDenylist: [/^\/api\//, /^\/files\//],
      },
    }),
  ],
})
