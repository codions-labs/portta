import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { changedFiles, selectTests } from '../lib/affected.mjs'
import { allBrowser, allGateway, ciScope } from '../lib/ci-scope.mjs'
import { root } from '../lib/execution.mjs'
import { parseOptions } from '../lib/runner-options.mjs'

test('removed or unmatched test falls back to its workspace', () => {
  assert.ok(
    selectTests(root, ['packages/db/tests/removed.test.ts']).actions.some(
      (a) => a.workspace === 'portta-db' && !a.filter,
    ),
  )
})
test('unknown and global config paths produce gaps', () => {
  assert.equal(selectTests(root, ['unknown.file', 'package-lock.json']).gaps.length, 2)
})
test('E2E is advisory and never implicitly starts containers', () => {
  const result = selectTests(root, ['tests/e2e/apply.test.sh', 'apps/web/e2e/roles.spec.ts'])
  assert.equal(result.actions.length, 0)
  assert.equal(result.recommendations.length, 2)
})
test('diff covers committed, staged, unstaged, removed, renamed and new files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portta-diff-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  try {
    git('init', '-q')
    git('config', 'user.email', 'test@example.test')
    git('config', 'user.name', 'Test')
    for (const name of ['old', 'removed', 'dirty', 'committed']) writeFileSync(join(dir, name), 'original')
    git('add', '.')
    git('commit', '-qm', 'baseline')
    git('branch', 'baseline')
    writeFileSync(join(dir, 'committed'), 'new')
    git('commit', '-qam', 'change')
    renameSync(join(dir, 'old'), join(dir, 'renamed'))
    git('add', '-A')
    rmSync(join(dir, 'removed'))
    writeFileSync(join(dir, 'dirty'), 'new')
    writeFileSync(join(dir, 'new'), 'new')
    assert.deepEqual(changedFiles(dir, 'baseline'), ['committed', 'dirty', 'new', 'old', 'removed', 'renamed'])
    assert.ok(!changedFiles(dir).includes('committed'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
test('runner parts select their own slice of integration', () => {
  for (const args of [
    ['--integration', '--lint'],
    ['--e2e', '--suite', 'x', '--spec', 'y'],
    ['--integration', '--workspaces', 'nope'],
    ['--integration', '--part', 'static', '--workspaces', 'portta-db'],
  ])
    assert.throws(() => parseOptions(args))
  assert.deepEqual(parseOptions(['--integration', '--workspaces', 'portta-core,@codions/portta']).workspaces, [
    'portta-core',
    '@codions/portta',
  ])
  assert.equal(parseOptions(['--integration', '--part', 'static']).part, 'static')
})
test('CI runs E2E only for paths a suite exercises', () => {
  const pick = (files, mode, dependencies) => {
    const { code, gateway, browser } = ciScope(files, mode, dependencies)
    return { code, gateway, browser }
  }
  const none = { code: true, gateway: [], browser: [] }
  assert.deepEqual(pick(['package-lock.json', 'package.json', 'apps/web/package.json']), none)
  assert.deepEqual(
    pick([
      'scripts/lib/x.sh',
      '.env.example',
      '.github/workflows/publish.yaml',
      '.github/workflows/publish-images.yaml',
    ]),
    none,
  )
  assert.deepEqual(pick(['apps/web/components/ui/button.tsx']), none)
  assert.equal(ciScope(['docs/development/testing.md']).code, false)
  assert.equal(ciScope(['docs/development/testing.md']).docs, true)
  assert.equal(ciScope(['packages/core/src/apply.ts']).docs, false)
  assert.equal(ciScope(['packages/core/src/apply.ts', 'docs/README.md']).docs, true)
  assert.equal(ciScope(['packages/core/src/apply.ts'], 'release').docs, true)
  assert.deepEqual(pick(['packages/core/src/apply.ts', 'tests/e2e/apply.test.sh'], 'light'), none)
  assert.deepEqual(pick(['tests/docker/run.mjs', 'tests/gateway-e2e.mjs']).gateway, ['lifecycle'])
  assert.deepEqual(pick(['packages/core/src/apply.ts']).gateway, ['apply'])
  assert.deepEqual(pick(['packages/cli/src/commands/tls.ts']).gateway, ['local-tls'])
  assert.deepEqual(pick(['apps/web/package.json'], 'pr', ['apps/web/package.json']).gateway, ['web-panel'])
  assert.ok(ciScope(['packages/auth/src/bootstrap.ts']).browser.includes('roles'))
  assert.deepEqual(pick(undefined), { code: true, gateway: ['lifecycle'], browser: ['panel'] })
})
test('release runs every suite, and every suite has a shard', () => {
  const release = ciScope(['docs/README.md'], 'release')
  // The browser list is checked against the specs on disk, so a renamed or
  // removed spec cannot linger in it. The taskflow project needs tmux and a
  // host daemon, so it runs locally rather than in CI.
  const specs = readdirSync(join(root, 'apps/web/e2e'))
    .filter((name) => name.endsWith('.spec.ts'))
    .map((name) => name.slice(0, -'.spec.ts'.length))
    .filter((name) => name !== 'taskflow')
  assert.deepEqual([...allBrowser].sort(), specs.sort())
  assert.deepEqual(release.gateway, [...allGateway].sort())
  assert.deepEqual(release.browser, [...allBrowser].sort())
  assert.deepEqual(release.shards.flatMap((shard) => shard.suites).sort(), [...allGateway].sort())
})
