// The images the gateway suites need, shared by tests/docker/prepare-images.mjs
// (which builds and pulls them) and tests/gateway-e2e.mjs (which streams them
// into the disposable host), so the two lists cannot drift.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { porttaImages } from '../../packages/core/src/images.ts'

// Pinned third-party references, read from what the suites actually start: the
// gateway's own services, the fixtures, the suites and the access bridge.
// Integrations no suite enables (Tailscale, Cloudflare Tunnel) are left out.
const sources = [
  'docker/compose/compose.yaml',
  'docker/compose/features',
  'docker/compose/profiles',
  'tests/fixtures',
  'tests/e2e',
  'packages/core/src/discovery.ts',
]
const unused = new Set(['docker/compose/features/cloudflare-tunnel.yaml'])
const reference =
  /(?<![\w./-])((?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*):(v?\d+\.\d+[\w.-]*)(?![\w:/])/g

function files(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((entry) => files(join(path, entry)))
}

function thirdPartyImages(root) {
  const found = new Set()
  for (const file of sources.flatMap((source) => files(join(root, source)))) {
    if (unused.has(relative(root, file)) || !/\.(ya?ml|sh|ts|conf)$|Dockerfile$/.test(file)) continue
    for (const [, name, tag] of readFileSync(file, 'utf8').matchAll(reference)) {
      // Addresses (127.0.0.1:5432, $1:127.0.0.1) are not images.
      if (!/^[a-z]/.test(name) || (!name.includes('/') && name.includes('.'))) continue
      if (name.startsWith('codions-labs/') || name.startsWith('ghcr.io/codions-labs/')) continue
      found.add(`${name}:${tag}`)
    }
  }
  return [...found].sort()
}

export function e2eImages(root) {
  // A source checkout builds under the CLI's local identity (versionForRoot in
  // packages/cli/src/context.ts). The host selects exactly these tags with
  // `up local --local-release`, which refuses a missing one by name.
  const version = readFileSync(join(root, 'packages/cli/src/context.ts'), 'utf8').match(
    /LOCAL_DEV_VERSION = '([^']+)'/,
  )?.[1]
  if (!version) throw new Error('Could not read LOCAL_DEV_VERSION from packages/cli/src/context.ts')
  const images = porttaImages(version)
  // The same builds as localReleaseBuilds in packages/cli/src/commands/build.ts.
  const builds = [
    { name: 'runtime', image: images.runtime, args: ['--target', 'runtime', '-f', 'apps/web/Dockerfile', '.'] },
    { name: 'apply', image: images.apply, args: ['docker/images/apply'] },
    { name: 'toolbox', image: images.toolbox, args: ['docker/images/toolbox'] },
  ]
  const thirdParty = thirdPartyImages(root)
  return { version, builds, thirdParty, all: [...builds.map(({ image }) => image), ...thirdParty] }
}
