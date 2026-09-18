// The entry points, bundled.
//
// `packages: 'external'` keeps every dependency out of the bundle: the runtime
// image installs them, Next needs its own files on disk, and the database
// driver opens sockets a bundler cannot follow. What this produces is one
// module that resolves the workspace packages' `dist/` — which is why the image
// builds them first.

import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('.', import.meta.url))

await build({
  // Two: the panel itself, and the one script that has to run beside it with
  // the same database and the same auth configuration. Named rather than
  // listed, so `dist/server.mjs` keeps the name the image, the Compose file and
  // the end-to-end harness all start.
  entryPoints: { server: `${root}server/main.ts`, 'reset-password': `${root}server/reset-password.ts` },
  outdir: `${root}dist`,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
})
