import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bootstrapIdentity } from './publish-identity.mjs'

const root = resolve(import.meta.dirname, '..')

function git(args, cwd = root) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
}

function versionExists(version) {
  const result = spawnSync(
    'npm',
    ['view', `@codions/portta@${version}`, 'version', '--registry=https://registry.npmjs.org/'],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status === 0) return true
  if (/E404/.test(`${result.stdout}\n${result.stderr}`)) return false
  throw new Error(result.stderr.trim() || result.stdout.trim() || 'could not query npm')
}

if (git(['branch', '--show-current']) !== 'develop')
  throw new Error('bootstrap publication must start from the develop branch')
if (git(['status', '--porcelain'])) throw new Error('refusing to publish from a dirty worktree')

const identity = bootstrapIdentity(git(['rev-parse', 'HEAD']))
if (versionExists(identity.version)) throw new Error(`npm already has @codions/portta@${identity.version}`)

const temporary = mkdtempSync(join(tmpdir(), 'portta-publish-'))
const worktree = join(temporary, 'checkout')
try {
  run('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], root)
  run('npm', ['ci'], worktree)
  run(process.execPath, ['tooling/prepare-publication.mjs', identity.version], worktree)
  run('npm', ['run', 'typecheck', '--workspace=@codions/portta'], worktree)
  run('npm', ['test', '--workspace=@codions/portta'], worktree)
  run('npm', ['run', 'build', '--workspace=@codions/portta'], worktree)
  run('npm', ['run', 'test:package'], worktree, { PORTTA_EXPECTED_VERSION: identity.version })
  // The steps above are the lifecycle scripts; do not run them a second time.
  run(
    'npm',
    ['publish', '--workspace=@codions/portta', '--tag', identity.npmTag, '--access', 'public', '--ignore-scripts'],
    worktree,
  )
} finally {
  try {
    run('git', ['worktree', 'remove', '--force', worktree], root)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
