// Executed only inside the newly created disposable host.
//
//   node tests/docker/run.mjs [--prebuilt-images] SUITE...
//
// --prebuilt-images says tests/gateway-e2e.mjs already loaded the images
// tests/docker/prepare-images.mjs built, so `portta build` is skipped; without
// it the host builds the release images itself.
import { execFileSync } from 'node:child_process'
import { cpSync, readFileSync, writeFileSync } from 'node:fs'
import { runStep } from '../lib/execution.mjs'

if (process.cwd() !== '/work' || readFileSync('/proc/1/comm', 'utf8').trim() !== 'dockerd')
  throw new Error('This entrypoint runs only inside the disposable Docker host')

const args = process.argv.slice(2)
const prebuilt = args[0] === '--prebuilt-images'
if (prebuilt) args.shift()

const id = execFileSync('docker', ['info', '--format', '{{.ID}}'], { encoding: 'utf8' }).trim()
writeFileSync('/run/portta-e2e-owner.json', JSON.stringify({ id, root: '/work' }))
for (const gitArgs of [
  ['init', '-q'],
  ['config', 'user.email', 'e2e@example.test'],
  ['config', 'user.name', 'E2E'],
  ['add', '.'],
  ['commit', '-qm', 'Disposable test source'],
])
  execFileSync('git', gitArgs)
cpSync('.env.example', '.env')
if (!(await runStep('install dependencies', 'npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'])))
  process.exit(1)
// The suites need only the CLI: it bundles portta-core and portta-contracts
// from source, the shell helpers import portta-core with the development
// condition, and the panel image builds its own workspaces from its Dockerfile.
if (!(await runStep('build @codions/portta', 'npm', ['run', 'build', '--workspace=@codions/portta']))) process.exit(1)
if (!prebuilt && !(await runStep('gateway build', 'bin/portta', ['build']))) process.exit(1)
// Building and selecting are separate on purpose for operators (`just up`
// adds --local-release). The disposable host must make the same selection or
// its suites exercise the published image instead of this checkout.
if (!(await runStep('select local gateway release', 'bin/portta', ['up', 'local', '--local-release']))) process.exit(1)
let passed = true
for (const name of args) {
  passed = (await runStep(`gateway ${name}`, 'bash', [`tests/e2e/${name}.test.sh`])) && passed
}
process.exitCode = passed ? 0 : 1
