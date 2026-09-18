import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The login page a protected project hostname shows.
//
// It is a page, not an app: one form, no router, no query cache. Vite builds it
// because it has to be a static bundle the ForwardAuth service can serve from
// any origin — it cannot be a route of the panel, which is exactly the point.
export default defineConfig({
  root: resolve(import.meta.dirname, 'ui'),
  // Served under a path Traefik reserves, so it can never collide with a route
  // the protected project itself wants.
  base: '/__portta/auth/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/ui'),
    emptyOutDir: true,
    // esbuild, not Vite's default lightningcss.
    //
    // lightningcss is a native binding chosen per platform, and the lockfile
    // records no `libc` for the Linux ones — so `npm ci` inside the Alpine
    // image picks between the gnu and the musl build arbitrarily, and picking
    // the wrong one fails the image build with a missing `.node`. This is one
    // login page's CSS; esbuild minifies it perfectly well and needs nothing
    // that has to be compiled for the machine it runs on.
    cssMinify: 'esbuild',
  },
})
