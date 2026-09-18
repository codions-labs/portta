// The database one E2E run gets, and that it belongs to that run alone.
//
// The panel opens a SQLite file (ADR 0037), so the fixture is a directory and
// there is no container to own. What has to hold: two runs never share a path,
// and teardown removes what it made and nothing above it.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { startDatabase } from '../../apps/web/e2e/resources.mjs'

test('each run gets its own path, under the system temporary directory', async () => {
  const one = await startDatabase()
  const two = await startDatabase()
  try {
    assert.notEqual(dirname(one.file), dirname(two.file))
    for (const resource of [one, two]) {
      assert.ok(resource.file.startsWith(tmpdir()), resource.file)
      assert.equal(resource.file.endsWith('portta.db'), true)
      // The directory exists and the file does not: the panel creates it, which
      // is the behaviour a fresh installation has and the fixture should not
      // paper over.
      assert.ok(existsSync(dirname(resource.file)))
      assert.equal(existsSync(resource.file), false)
    }
  } finally {
    await one.close()
    await two.close()
  }
})

test('teardown removes the whole database, and closing twice is not an error', async () => {
  const resource = await startDatabase()
  // All three files a WAL database is, so a leftover `-wal` cannot carry one
  // run's writes into the next.
  mkdirSync(dirname(resource.file), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) writeFileSync(`${resource.file}${suffix}`, '')

  await resource.close()
  assert.equal(existsSync(dirname(resource.file)), false)
  await resource.close()
})

test('it never hands back a path inside an installation', async () => {
  const resource = await startDatabase()
  try {
    // The failure this rules out: a fixture that resolved to
    // `$PORTTA_HOME/state/panel/portta.db` would empty a real installation on
    // teardown.
    assert.equal(resource.file.includes(join('state', 'panel')), false)
  } finally {
    await resource.close()
  }
})
