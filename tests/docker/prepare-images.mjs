// Builds and pulls every image the gateway suites need into the daemon it runs
// against, outside the disposable host. tests/gateway-e2e.mjs then streams them
// into the host (PORTTA_E2E_PREBUILT_IMAGES=1). It only builds, pulls and tags:
// it never starts, stops or removes a container, a volume or a network.
//
//   node tests/docker/prepare-images.mjs [--output e2e-images.tar]
//
// --output also saves them into one archive, for PORTTA_E2E_IMAGE_ARCHIVE.
// On GitHub Actions (ACTIONS_RUNTIME_TOKEN plus a cache URL in the environment)
// Portta's own images use the GHA build cache.
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { root, runStep } from '../lib/execution.mjs'
import { e2eImages } from './images.mjs'

const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--output')) throw new Error('Expected [--output FILE.tar]')
const output = args[1] && resolve(args[1])

const { version, builds, thirdParty, all } = e2eImages(root)
const gha = process.env.ACTIONS_RUNTIME_TOKEN && (process.env.ACTIONS_CACHE_URL || process.env.ACTIONS_RESULTS_URL)

async function build({ name, image, args: buildArgs }) {
  const cache = gha
    ? ['--cache-from', `type=gha,scope=e2e-${name}`, '--cache-to', `type=gha,mode=max,scope=e2e-${name}`]
    : []
  return runStep(`build ${name} image`, 'docker', [
    'buildx',
    'build',
    '--load',
    '--build-arg',
    `PORTTA_VERSION=${version}`,
    ...cache,
    '-t',
    image,
    ...buildArgs,
  ])
}

console.log(`Portta images (${version}): ${builds.map(({ image }) => image).join(', ')}`)
console.log(`Third-party images: ${thirdParty.join(', ')}`)
const results = await Promise.all([
  ...builds.map(build),
  ...thirdParty.map((image) => runStep(`pull ${image}`, 'docker', ['pull', image])),
])
if (results.includes(false)) process.exit(1)
if (output) {
  mkdirSync(dirname(output), { recursive: true })
  if (!(await runStep('save image archive', 'docker', ['save', '-o', output, ...all]))) process.exit(1)
}
console.log(all.join('\n'))
