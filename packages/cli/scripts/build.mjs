import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { collectKnowledge, writeCorpus } from '../../../tooling/docs.mjs'

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
await build({
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
  logLevel: 'info',
})

// Taskflow's builtin workflows and its authoring skill, where the bundles look
// for them (`portta-host/taskflow/assets`).
const assets = resolve(output, 'assets')
cpSync(resolve(root, '../host/workflows'), resolve(assets, 'workflows'), { recursive: true })
cpSync(resolve(root, '../../skills/portta-workflows'), resolve(assets, 'skills', 'portta-workflows'), {
  recursive: true,
})

writeCorpus(collectKnowledge(), resolve(output, 'documentation.json'))

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
