import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { preparePublication } from '../../tooling/prepare-publication.mjs'

test('publication preparation changes only the staged CLI manifest and runtime version', () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-publication-'))
  try {
    mkdirSync(join(root, 'packages/cli'), { recursive: true })
    writeFileSync(join(root, 'packages/cli/package.json'), '{"name":"@codions/portta","version":"0.8.0"}\n')
    preparePublication(root, '0.0.0-develop.7.sha-abcdef0')
    assert.equal(
      JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')).version,
      '0.0.0-develop.7.sha-abcdef0',
    )
    assert.equal(readFileSync(join(root, 'VERSION'), 'utf8'), '0.0.0-develop.7.sha-abcdef0\n')
    assert.throws(() => preparePublication(root, '0.8'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
