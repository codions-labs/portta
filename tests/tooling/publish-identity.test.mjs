import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bootstrapIdentity, releaseIdentity, resolvePublication } from '../../tooling/publish-identity.mjs'

const SHA = 'a1b2c3d4e5f6789012345678901234567890abcd'
const NOW = new Date('2026-09-14T20:30:45Z')

test('publication identities keep development channels separate from releases', () => {
  assert.deepEqual(resolvePublication({ eventName: 'push', refName: 'develop', sha: SHA, now: NOW }), {
    version: '0.0.0-develop.20260914203045.sha-a1b2c3d',
    channel: 'develop',
    npmTag: 'dev',
    ref: SHA,
  })
  assert.deepEqual(resolvePublication({ eventName: 'push', refName: 'main', sha: SHA, now: NOW }), {
    version: '0.0.0-next.20260914203045.sha-a1b2c3d',
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
  assert.throws(() => resolvePublication({ eventName: 'push', refName: 'feature/test', sha: SHA }))
})

test('bootstrap versions are development prereleases', () => {
  assert.deepEqual(bootstrapIdentity(SHA, NOW), {
    version: '0.0.0-develop.20260914203045.sha-a1b2c3d',
    channel: 'develop',
    npmTag: 'dev',
  })
})

// A recreated repository restarts github.run_number, so the counter the versions
// carried until 0.0.0-develop.178 can never be the ordering key again.
test('development versions stay above every run-numbered version npm already holds', () => {
  const { version } = resolvePublication({ eventName: 'push', refName: 'develop', sha: SHA, now: NOW })
  const counter = (value) => Number(value.split('.')[3])
  assert.ok(counter(version) > counter('0.0.0-develop.178.sha-7d97293'))
  const later = resolvePublication({
    eventName: 'push',
    refName: 'develop',
    sha: SHA,
    now: new Date(NOW.valueOf() + 1000),
  })
  assert.ok(counter(later.version) > counter(version))
})
