import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves a project site under `/<repo>/`; the workflow passes the
// repository name in VITE_BASE. A local build defaults to the same path.
const base = process.env.VITE_BASE ?? '/yae-viewer/';

export default defineConfig({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/favicon.ico', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      manifest: {
        name: 'YAE Viewer',
        short_name: 'YAE Viewer',
        description:
          'Viewer for You Are Empty (2006) assets: levels with lightmaps, collisions and navmesh, models with skeleton and animations.',
        theme_color: '#0D0F13',
        background_color: '#0D0F13',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // An installed viewer registers as a handler for the game's files: the OS
        // "Open with…" hands them over through window.launchQueue.
        file_handlers: [
          {
            action: base,
            accept: {
              'application/octet-stream': ['.ds2', '.ds2md', '.ds2cm', '.ds2cm2', '.ds2aim'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // three.js + fonts: raise the precache limit above the default 2 MB.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  server: { port: 5180 },
});
