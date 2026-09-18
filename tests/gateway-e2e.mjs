import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { e2eImages } from './docker/images.mjs'
import { reportDir, root, runStep } from './lib/execution.mjs'
import { gatewaySourceFiles } from './lib/gateway-source.mjs'

const args = process.argv.slice(2)
const names = readdirSync(join(root, 'tests/e2e'))
  .filter((f) => f.endsWith('.test.sh'))
  .map((f) => f.slice(0, -8))
if (args.length && (args.length !== 2 || !['--suite', '--suites'].includes(args[0])))
  throw new Error('Expected --suite NAME or --suites NAME,NAME')
const suites = args.length ? args[1].split(',') : names.sort()
if (!suites.length || suites.some((suite) => !names.includes(suite)))
  throw new Error(`Unknown suite; choose ${names.join(', ')}`)
const owner = randomUUID(),
  name = `portta-e2e-host-${owner}`
const image = `portta-e2e-host:${owner}`
const temporary = mkdtempSync(join(tmpdir(), 'portta-e2e-source-'))
const docker = (...arguments_) =>
  execFileSync('docker', arguments_, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let container
let interrupted = false
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    interrupted = true
  })
try {
  // Copy source, including the current diff, but never local credentials/state
  // or caches. The inner daemon sees only this disposable checkout.
  const files = gatewaySourceFiles(root)
  for (const file of files) {
    const source = join(root, file)
    if (!existsSync(source)) continue
    mkdirSync(dirname(join(temporary, file)), { recursive: true })
    if (lstatSync(source).isSymbolicLink()) symlinkSync(readlinkSync(source), join(temporary, file))
    else cpSync(source, join(temporary, file), { dereference: false })
  }
  if (!(await runStep('disposable host image', 'docker', ['build', '-t', image, 'tests/docker'])))
    throw new Error('E2E host build failed')
  if (interrupted) throw new Error('Interrupted before E2E startup')
  container = docker('create', '--privileged', '--name', name, '--label', `portta.e2e.run=${owner}`, image)
  docker('cp', `${temporary}/.`, `${container}:/work`)
  // CI prepares images and the npm cache outside the host
  // (tests/docker/prepare-images.mjs). They are copied or streamed, never
  // mounted, so the host still shares nothing with the machine running it.
  const archive = process.env.PORTTA_E2E_IMAGE_ARCHIVE
  const streamed = process.env.PORTTA_E2E_PREBUILT_IMAGES === '1'
  const npmCache = process.env.PORTTA_E2E_NPM_CACHE
  if (archive && streamed) throw new Error('Choose PORTTA_E2E_IMAGE_ARCHIVE or PORTTA_E2E_PREBUILT_IMAGES')
  if (archive && !existsSync(archive)) throw new Error(`PORTTA_E2E_IMAGE_ARCHIVE does not exist: ${archive}`)
  if (
    npmCache &&
    existsSync(npmCache) &&
    !(await runStep('copy npm cache', 'docker', ['cp', `${npmCache}/.`, `${container}:/root/.npm`]))
  )
    throw new Error('Could not copy the npm cache into the E2E host')
  docker('start', container)
  let ready = false
  for (let i = 0; i < 120; i++) {
    if (interrupted) throw new Error('Interrupted during E2E startup')
    try {
      docker('exec', container, 'docker', 'info')
      ready = true
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!ready) throw new Error('Disposable daemon failed to start')
  // Streamed straight into the host's daemon: no temporary archive on either
  // side, which is what fills a CI runner's disk.
  const load = streamed
    ? ['docker save "$@" | docker exec -i "$0" docker load', container, ...e2eImages(root).all]
    : archive
      ? ['docker exec -i "$0" docker load < "$1"', container, archive]
      : undefined
  if (load && !(await runStep('load prepared images', 'bash', ['-o', 'pipefail', '-c', ...load])))
    throw new Error('Could not load the prepared images into the E2E host')
  const prebuilt = load ? ['--prebuilt-images'] : []
  if (
    !(await runStep('gateway environment and suites', 'docker', [
      'exec',
      container,
      'node',
      'tests/docker/run.mjs',
      ...prebuilt,
      ...suites,
    ]))
  )
    process.exitCode = 1
} finally {
  const cleanupStarted = performance.now()
  if (container) {
    mkdirSync(reportDir, { recursive: true })
    try {
      docker('cp', `${container}:/work/test-results`, join(reportDir, 'gateway'))
    } catch {
      /* startup may have failed before reports */
    }
    if (docker('inspect', '-f', '{{index .Config.Labels "portta.e2e.run"}}', container) === owner) {
      // -v removes only the anonymous data volume created with this container.
      docker('rm', '-f', '-v', container)
    } else {
      // A throw here would replace the run's own error, so the refusal is reported instead.
      console.error('Refusing to remove a host whose ownership changed')
      process.exitCode = 1
    }
  }
  rmSync(temporary, { recursive: true, force: true })
  try {
    docker('image', 'rm', image)
  } catch {
    /* image build may not have completed */
  }
  console.log(`E2E owned host teardown: ${((performance.now() - cleanupStarted) / 1000).toFixed(3)}s`)
}
