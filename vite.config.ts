import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// The MapLibre worker we import with `?url` in src/features/map/ThreatMapPage.tsx
// still contains a plain ES import for `./maplibre-gl-shared.mjs`. Vite copies
// the worker file into `dist/assets/` but does not follow that sibling import,
// so the shared module ends up missing at runtime; Render's SPA rewrite then
// returns `index.html` for it and the browser rejects it as JS (MIME type
// text/html). Emit the shared file alongside the worker to make the sibling
// import resolve on the deployed site the same way it does in node_modules.
function copyMaplibreWorkerShared(): Plugin {
  return {
    name: 'copy-maplibre-worker-shared',
    apply: 'build',
    generateBundle() {
      const sourcePath = fileURLToPath(
        new URL('./node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs', import.meta.url),
      )
      this.emitFile({
        type: 'asset',
        fileName: 'assets/maplibre-gl-shared.mjs',
        source: readFileSync(sourcePath),
      })
    },
  }
}

// Camera access over a LAN address requires HTTPS. The development certificate
// stays in memory and does not change the operating system trust store.
const httpsEnabled = process.env.VITE_HTTPS === 'true'

export default defineConfig({
  // Prebundle MapLibre into a self-contained worker. Without this, its worker
  // can import Vite browser modules that require `window` or `document`, which
  // makes the worker fail and leaves the map blank during development.
  optimizeDeps: {
    include: ['maplibre-gl'],
    // ONNX Runtime resolves its WASM file relative to its ESM bundle. Vite's
    // development pre-bundler rewrites that URL into an HTML fallback path.
    exclude: ['onnxruntime-web/webgpu'],
  },
  plugins: [
    react(),
    ...(httpsEnabled ? [basicSsl()] : []),
    copyMaplibreWorkerShared(),
    VitePWA({
      // Replace the cached application shell as soon as a new release is ready.
      registerType: 'autoUpdate',
      // Registration is owned by src/pwa-update.ts so the app can check for
      // a release on launch/resume and reload once the new worker takes over.
      injectRegister: null,
      includeAssets: ['invatrace-logo-192.png', 'invatrace-logo-512.png'],
      manifest: {
        name: 'InvaTrace',
        short_name: 'InvaTrace',
        description: 'Invasive plant monitoring and trail recovery',
        theme_color: '#FFFFFF',
        background_color: '#F4F6F3',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'invatrace-logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'invatrace-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'invatrace-logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // The ONNX model and its manifest are checksum-verified by the
            // browser adapter on first load, so once a response is good it is
            // safe to keep. Cache it so scanning still works offline.
            urlPattern: ({ url }) => url.pathname.startsWith('/models/invatrace-student33-v1/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-student33-model-v1',
              expiration: { maxEntries: 12, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // The hashed runtime is large, so cache it after first inference
            // instead of slowing service-worker installation with a precache.
            urlPattern: ({ url }) => /\/assets\/ort-wasm-.+\.wasm$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-onnx-runtime',
              expiration: { maxEntries: 2, maxAgeSeconds: 365 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // AC Iteration 1 P2 - server model-config gates the acceptance
            // threshold. Cache the last-known-good response so a second scan
            // after going offline still gets a server-authoritative gate
            // rather than falling back to client-only. Revalidate in the
            // background whenever the network returns.
            urlPattern: ({ url }) => url.pathname === '/api/v1/model-config',
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'invatrace-model-config',
              expiration: { maxEntries: 4, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // AC Iteration 1 P2 - species detail lookups must remain
            // available offline so the result screen can show the authoritative
            // Malaysian status and reviewed guidance for a previously-seen
            // species without a network round trip.
            urlPattern: ({ url }) => /^\/api\/v1\/species\/[^/]+$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'invatrace-species-detail',
              expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Private-access and recovery traffic contains installation credentials
            // or one-time secrets and must never enter Cache Storage.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'POST',
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/v1/profiles'),
            handler: 'NetworkOnly',
            method: 'PATCH',
          },
          {
            // The default vector basemap also needs its style, TileJSON and
            // sprite index before any tile can draw. These change when
            // OpenFreeMap publishes a new build, so serve the cached copy for
            // offline use but refresh it in the background.
            urlPattern: ({ url }) =>
              url.hostname.endsWith('openfreemap.org') &&
              !/\.(png|jpg|jpeg|webp|pbf)$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'invatrace-map-styles',
              expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Keep recently viewed map areas available offline, with a fixed
            // cache limit to control disk use.
            urlPattern: ({ url }) =>
              /\.(png|jpg|jpeg|webp|pbf)$/.test(url.pathname) &&
              (url.hostname.endsWith('tile.openstreetmap.org') ||
                url.hostname.endsWith('openfreemap.org') ||
                url.hostname.endsWith('maptiler.com') ||
                url.hostname.endsWith('stadiamaps.com') ||
                url.hostname.endsWith('basemaps.cartocdn.com')),
            handler: 'CacheFirst',
            options: {
              cacheName: 'invatrace-map-tiles',
              expiration: { maxEntries: 800, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    // MapLibre ships as one self-contained module. It is loaded only with the
    // map route, so keep it in a clearly named chunk and set the warning limit
    // just above its measured size. Other unexpectedly large chunks still warn.
    chunkSizeWarningLimit: 1050,
    rollupOptions: {
      output: {
        manualChunks: { 'map-engine': ['maplibre-gl'] },
      },
    },
  },
  server: { port: 5173 },
})
