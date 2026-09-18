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
    assert.equal(existsSync(join(installed, 'dist', 'documentation.json')), true)
    assert.equal(existsSync(join(installed, 'dist', 'runtime', 'VERSION')), true)

    // The host daemon, the Taskflow supervisor and the module's assets ship
    // beside the CLI that starts them.
    for (const file of ['host.js', 'supervisor.js', 'assets/workflows', 'assets/skills/portta-workflows/SKILL.md']) {
      assert.equal(existsSync(join(installed, 'dist', file)), true, `missing dist/${file}`)
    }

    assert.match(run(executable, ['--help'], installRoot), /portta/)
    const flowHelp = spawnSync(executable, ['flow', '--help'], {
      cwd: installRoot,
      encoding: 'utf8',
    })
    assert.equal(flowHelp.status, 0, flowHelp.stderr)
    assert.match(flowHelp.stdout, /Usage: portta flow/)
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
