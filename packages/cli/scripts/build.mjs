import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'
import { collectKnowledge } from '../../../tooling/docs.mjs'

const root = resolve(import.meta.dirname, '..')
const output = resolve(root, 'dist')
rmSync(output, { recursive: true, force: true })
mkdirSync(output, { recursive: true })

// Three programs from one build: the CLI; the host daemon it starts as a child
// (`portta host serve`), so the daemon never runs inside the CLI process; and
// the ACP supervisor the Taskflow module starts on demand, which outlives a
// daemon restart so the agents it holds keep running. All three sit in `dist/`,
// where each finds the others beside itself.
//
// Workspace packages resolve through their `development` export condition, from
// source. What stays outside the bundle is what must be found on disk at
// runtime: a native addon, and packages that locate their own files or spawn
// their own entry points relative to where they are installed.
// Zod ships 63 locales and reaches them through a barrel. Our own code imports
// zod by name (`portta-core/zod`), which tree shakes, but `hono-openapi` pulls
// the barrel in with `await import('zod/v4/core')` — a dynamic namespace import
// no bundler can prune. Only `en` is ever used, so the barrel is narrowed to it.
// `matched` guards the seam: if a zod upgrade moves this file the build fails
// here instead of quietly growing by 240 KB again.
const localeDirectory = resolve(root, '../../node_modules/zod/v4/locales')
let matched = 0
const englishLocaleOnly = {
  name: 'zod-english-locale-only',
  setup(plugin) {
    plugin.onLoad({ filter: /zod\/v4\/locales\/index\.js$/ }, () => {
      matched += 1
      return { contents: "export { default as en } from './en.js'", loader: 'js', resolveDir: localeDirectory }
    })
  },
}

await build({
  plugins: [englishLocaleOnly],
  entryPoints: [
    { in: resolve(root, 'src/cli.ts'), out: 'cli' },
    { in: resolve(root, '../host/src/bin.ts'), out: 'host' },
    { in: resolve(root, '../host/src/modules/taskflow/server/supervisor.ts'), out: 'supervisor' },
  ],
  outdir: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  conditions: ['development'],
  external: [
    'better-sqlite3',
    '@devcontainers/cli',
    '@anthropic-ai/claude-agent-sdk',
    '@agentclientprotocol/claude-agent-acp',
    '@agentclientprotocol/codex-acp',
    'pi-acp',
    // Not a resolution constraint like the ones above: `systeminformation` is a
    // barrel over the probes of every operating system, 709 KB for the eleven
    // calls `portta metrics` makes. It is a dependency of this package, so it
    // resolves from disk like any other runtime import.
    'systeminformation',
  ],
  // When this CLI was built, shown beside its version. PORTTA_BUILD_DATE pins it.
  define: {
    __PORTTA_BUILD_DATE__: JSON.stringify(
      process.env.PORTTA_BUILD_DATE ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ),
  },
  banner: {
    js: '#!/usr/bin/env node\nimport { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  // The three programs share most of their graph: without splitting the whole
  // host went into `cli.js` as well as `host.js`. Chunk names carry no
  // directory, so every module still sees `dist/` as `import.meta.dirname` —
  // which is how the bundles locate each other and their assets. The assertion
  // below keeps that true.
  splitting: true,
  chunkNames: '[name]-[hash]',
  // Names survive minification so a stack trace from an installed CLI still
  // points at something, and lines stay short enough that the frame Node prints
  // above it is readable rather than 80 KB of one line. Together they cost
  // about 5% of the bundle.
  minify: true,
  keepNames: true,
  lineLimit: 500,
  legalComments: 'none',
  logLevel: 'info',
})

if (matched === 0)
  throw new Error('the zod locale barrel was not narrowed: check whether zod still keeps it at v4/locales/index.js')

const nested = readdirSync(output, { recursive: true }).filter(
  (entry) => typeof entry === 'string' && entry.endsWith('.js') && entry.includes('/'),
)
if (nested.length > 0) throw new Error(`the bundle must stay flat in dist/, these are not: ${nested.join(', ')}`)

// Taskflow's builtin workflows and its authoring skill, where the bundles look
// for them (`portta-host/taskflow/assets`).
const assets = resolve(output, 'assets')
cpSync(resolve(root, '../host/workflows'), resolve(assets, 'workflows'), { recursive: true })
cpSync(resolve(root, '../../skills/portta-workflows'), resolve(assets, 'skills', 'portta-workflows'), {
  recursive: true,
})

// The documentation corpus, gzipped: 1.6 MB of JSON that compresses to 400 KB,
// read only by `portta docs`, which pays a few milliseconds to inflate it.
writeFileSync(resolve(output, 'documentation.json.gz'), gzipSync(`${JSON.stringify(collectKnowledge())}\n`))

const repository = resolve(root, '../..')
const runtime = resolve(output, 'runtime')
mkdirSync(runtime, { recursive: true })
// VERSION is an installed-runtime input, not source controlled state. CI sets
// PORTTA_BUILD_VERSION from the release or development channel; local builds
// use the CLI manifest, which in source is always the 0.0.0-local identity.
const version =
  process.env.PORTTA_BUILD_VERSION ?? JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:[-+][0-9A-Za-z.-]+)?$/.test(version))
  throw new Error(`invalid Portta build version: ${version}`)
writeFileSync(resolve(runtime, 'VERSION'), `${version}\n`)
// The images an installation builds itself: the applier and the toolbox. The
// sandbox image is published by its own workflow and pulled, never built here.
for (const entry of [
  '.env.example',
  'docker/compose',
  'docker/images/apply',
  'docker/images/toolbox',
  'templates',
  'scripts/lib/runner-exec.sh',
]) {
  cpSync(resolve(repository, entry), resolve(runtime, entry), { recursive: true })
}
// Only the tracked Traefik defaults: a checkout also holds generated files
// (local-tls.yaml, portta-*.yaml) that belong to that installation alone.
mkdirSync(resolve(runtime, 'config/traefik/dynamic'), { recursive: true })
for (const file of ['middlewares.yaml', 'tcp.yaml']) {
  cpSync(resolve(repository, 'config/traefik/dynamic', file), resolve(runtime, 'config/traefik/dynamic', file))
}

// The npm page of a package shows the README and the licence that sit at the
// root of its tarball, and this package has neither in source: both live at the
// repository root. They are generated here, beside the manifest, so publishing
// stays a build away and there is no second README to keep in sync.
cpSync(resolve(repository, 'LICENSE'), resolve(root, 'LICENSE'))
const readme = readFileSync(resolve(repository, 'README.md'), 'utf8')
// A relative target only resolves inside the repository. On npm the README is
// read far from it, so every link becomes an absolute GitHub URL; an image has
// to point at raw content, which a blob page is not.
const repositoryUrl = 'https://github.com/codions-labs/portta'
const rawUrl = 'https://raw.githubusercontent.com/codions-labs/portta/main'
writeFileSync(
  resolve(root, 'README.md'),
  readme.replace(
    /(!?)\[([^\]]*)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g,
    (_, image, text, target) =>
      `${image}[${text}](${image ? `${rawUrl}/${target}` : `${repositoryUrl}/blob/main/${target}`})`,
  ),
)
