import type { NextConfig } from 'next'

// Hosts a browser may load the development panel from. Next 16 refuses its dev
// resources, HMR's WebSocket included, to any origin but `localhost`, and the
// panel is opened at `http://127.0.0.1:8081` — so without this, hot reloading
// silently never connects. The panel URL and the extra trusted origins are the
// same hosts the panel already accepts a sign-in from. Production ignores it.
function developmentOrigins(env: NodeJS.ProcessEnv): string[] {
  const hosts = new Set(['127.0.0.1', '[::1]'])
  const urls = [env.PORTTA_PANEL_URL, ...(env.PORTTA_PANEL_TRUSTED_ORIGINS ?? '').split(',')]
  for (const url of urls) {
    try {
      if (url?.trim()) hosts.add(new URL(url.trim()).hostname)
    } catch {
      /* not a URL: nothing to allow */
    }
  }
  return [...hosts]
}

// The panel is one process: this config describes the Next half of it, and
// `server/main.ts` composes the rest around it. There is no `output:
// 'standalone'` because nothing runs Next on its own.
const config: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: developmentOrigins(process.env),
  // Compiled by Next, because client components import them too: they ship
  // TypeScript under the `development` condition and a browser chunk needs it
  // turned into JavaScript.
  transpilePackages: ['portta-core', 'portta-contracts'],
  // Left to Node. These open sockets, read directories beside themselves
  // (`packages/db/drizzle`) and resolve paths from `import.meta.url` — all
  // things a bundler either cannot follow or would rewrite into something that
  // no longer points at the file.
  serverExternalPackages: [
    'portta-server',
    'portta-auth-core',
    'portta-db',
    'better-auth',
    '@better-auth/api-key',
    'better-sqlite3',
    'drizzle-orm',
  ],
  // Only the end-to-end build turns this off, because CI typechecks on its
  // own; the image build still refuses a type error.
  typescript: { ignoreBuildErrors: process.env.PORTTA_SKIP_TYPECHECK === '1' },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // The panel can start, stop and remove containers. Nothing may frame
          // it, and nothing may guess at a response's type.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}

export default config
