import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

export default function build() {
  // For a run against dist/ that was already built, such as a CI job that
  // built it in an earlier step. Nothing checks that it is current.
  if (process.env.PORTTA_E2E_SKIP_BUILD === '1') {
    console.log('E2E build: skipped (PORTTA_E2E_SKIP_BUILD=1)')
    return
  }
  const root = resolve(import.meta.dirname, '../../..')
  const lock = resolve(root, 'apps/web/.e2e-build-lock')
  try {
    mkdirSync(lock)
  } catch {
    throw new Error(
      'Another E2E build holds apps/web/.e2e-build-lock; refusing concurrent writes. Remove it only after verifying its owner exited.',
    )
  }
  const start = performance.now()
  // Type errors are the typecheck's job, not this build's.
  const env = { ...process.env, PORTTA_SKIP_TYPECHECK: '1' }
  try {
    for (const workspace of [
      'portta-core',
      'portta-contracts',
      // portta-server imports it, so a clean `npm ci` has no dist for it to
      // resolve and the panel build fails on `Can't resolve 'portta-mcp'`.
      'portta-mcp',
      'portta-db',
      'portta-auth-core',
      'portta-server',
      '@codions/portta',
      'portta-web',
    ]) {
      execFileSync('npm', ['run', 'build', `--workspace=${workspace}`], { cwd: root, stdio: 'inherit', env })
    }
  } finally {
    rmSync(lock, { recursive: true })
  }
  console.log(`E2E build: ${((performance.now() - start) / 1000).toFixed(3)}s`)
}
