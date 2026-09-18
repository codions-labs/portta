import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapIdentity, releaseIdentity, resolvePublication } from '../../tooling/publish-identity.mjs'

const SHA = 'a1b2c3d4e5f6789012345678901234567890abcd'

test('publication identities keep development channels separate from releases', () => {
  assert.deepEqual(resolvePublication({ eventName: 'push', refName: 'develop', runNumber: '42', sha: SHA }), {
    version: '0.0.0-develop.42.sha-a1b2c3d',
    channel: 'develop',
    npmTag: 'dev',
    ref: SHA,
  })
  assert.deepEqual(resolvePublication({ eventName: 'push', refName: 'main', runNumber: '42', sha: SHA }), {
    version: '0.0.0-next.42.sha-a1b2c3d',
    channel: 'next',
    npmTag: 'next',
    ref: SHA,
  })
  assert.deepEqual(releaseIdentity('v0.8.0'), {
    version: '0.8.0',
    channel: 'release',
    npmTag: 'latest',
    ref: 'v0.8.0',
  })
})

test('only stable release tags can reach latest', () => {
  for (const tag of ['0.8.0', 'v0.8', 'v0.8.0-rc.1', 'v01.8.0']) assert.throws(() => releaseIdentity(tag))
  assert.throws(() => resolvePublication({ eventName: 'push', refName: 'feature/test', runNumber: '1', sha: SHA }))
})

test('bootstrap versions are development prereleases', () => {
  assert.deepEqual(bootstrapIdentity(SHA, new Date('2026-09-14T20:30:45Z')), {
    version: '0.0.0-develop.20260914203045.sha-a1b2c3d',
    channel: 'develop',
    npmTag: 'dev',
  })
  assert.match(
    resolvePublication({
      eventName: 'push',
      refName: 'develop',
      runNumber: '1',
      sha: '0123456789012345678901234567890123456789',
    }).version,
    /^0\.0\.0-develop\.1\.sha-0123456$/,
  )
})
