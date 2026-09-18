import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { daemonUnreachableHint } from './daemon.ts'
import { CommandUsageError, formatServerError, resolveProjectBaseUrl } from './shared.ts'

describe('formatServerError', () => {
  test('passes HTTP errors through untouched', () => {
    expect(formatServerError(new Error('HTTP 404: not found'), 5111)).toBe('HTTP 404: not found')
  })

  test("translates legacy 'fetch failed' connection errors", () => {
    expect(formatServerError(new Error('fetch failed'), 5111)).toBe(daemonUnreachableHint(5111))
    expect(daemonUnreachableHint(5111)).toContain('portta host serve')
  })

  test("translates Bun's connection-refused message", () => {
    // Bun throws this exact message (code ConnectionRefused) when nothing is
    // listening on the port — e.g. `portta flow oneshot` with no host daemon.
    const err = new Error('Unable to connect. Is the computer able to access the url?')
    expect(formatServerError(err, 5111)).toBe(daemonUnreachableHint(5111))
  })

  test('leaves unrelated errors untouched', () => {
    expect(formatServerError(new Error('Linear team not found'), 5111)).toBe('Linear team not found')
  })
})

describe('resolveProjectBaseUrl', () => {
  test('throws a clear usage error when run outside any git repository', async () => {
    // A non-git cwd can't be mapped to a served project, and the per-project
    // routes only exist under /<prefix> — so returning the bare base would just
    // 404. Surface the actionable message instead.
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-nogit-'))
    let error: unknown
    try {
      await resolveProjectBaseUrl(5111, dir)
    } catch (caught) {
      error = caught
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    expect(error).toBeInstanceOf(CommandUsageError)
    if (error instanceof Error) expect(error.message).toMatch(/git repository/i)
  })
})
