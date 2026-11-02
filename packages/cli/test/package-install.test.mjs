import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  return result.stdout.trim()
}

test('the packed npm package installs, runs, and ships its runtime assets outside the monorepo', () => {
  // Packing skips prepack, so it ships exactly the build the caller made.
  assert.ok(existsSync(join(packageRoot, 'dist', 'cli.js')), 'build first: npm run build --workspace=@codions/portta')
  const tempRoot = mkdtempSync(join(tmpdir(), 'portta-package-'))
  const packRoot = join(tempRoot, 'pack')
  const installRoot = join(tempRoot, 'install')

  try {
    mkdirSync(packRoot, { recursive: true })
    mkdirSync(installRoot, { recursive: true })

    const tarballName = run('npm', ['pack', packageRoot, '--ignore-scripts', '--pack-destination', packRoot], tempRoot)
      .split('\n')
      .at(-1)
    assert.ok(tarballName)
    const tarball = join(packRoot, tarballName)

    run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', tarball], installRoot)

    const installed = join(installRoot, 'node_modules', '@codions', 'portta')
    const executable = join(installRoot, 'node_modules', '.bin', 'portta')
    assert.equal(readFileSync(join(installed, 'dist', 'cli.js'), 'utf8').startsWith('#!/usr/bin/env node\n'), true)
    assert.equal(existsSync(join(installed, 'dist', 'documentation.json.gz')), true)
    assert.equal(existsSync(join(installed, 'dist', 'runtime', 'VERSION')), true)

    // What the npm page shows: the build writes both from the repository root.
    assert.equal(existsSync(join(installed, 'LICENSE')), true)
    const readme = readFileSync(join(installed, 'README.md'), 'utf8')
    assert.equal(readme.startsWith('# Portta\n'), true)
    // Read far from the repository, a relative target resolves nowhere.
    assert.equal(/\]\((?!https?:|mailto:|#)/.test(readme), false, 'the packed README keeps a relative link')

    assert.match(run(executable, ['--help'], installRoot), /portta/)

    // The agent layer comes out of the package: three skills and a hook that
    // always exits 0, installed into a temporary home with no network.
    const home = join(tempRoot, 'home')
    mkdirSync(join(home, '.claude'), { recursive: true })
    const env = { ...process.env, CLAUDE_CONFIG_DIR: undefined, CODEX_HOME: undefined }
    const installedAgents = spawnSync(executable, ['agents', 'install', 'claude', '--home', home, '--json'], {
      cwd: installRoot,
      encoding: 'utf8',
      env,
    })
    assert.equal(installedAgents.status, 0, installedAgents.stderr || installedAgents.stdout)
    for (const skill of ['portta-host-context', 'portta-adopt-compose', 'portta-dockerize'])
      assert.equal(existsSync(join(home, '.agents', 'skills', skill, 'SKILL.md')), true, `missing skill ${skill}`)
    const hook = join(home, '.config', 'portta', 'agents', 'hook.sh')
    assert.equal(spawnSync('bash', [hook], { encoding: 'utf8', env: { ...env, HOME: home } }).status, 0)
    const output = run(executable, ['--version'], installRoot)
    // A packed CLI is always a build, so it names when it was built.
    const matched = /^portta (\S+) \(built \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)$/.exec(output)
    assert.ok(matched, `unexpected --version output: ${output}`)
    const version = matched[1]
    const expectedVersion = process.env.PORTTA_EXPECTED_VERSION
    if (expectedVersion) assert.equal(version, expectedVersion)
    else assert.ok(semver.test(version))
  } finally {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})
