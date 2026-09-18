import { Hono } from 'hono'
import { CreateWorktreeRequestSchema } from 'portta-contracts/taskflow'
import { z } from 'portta-core/zod'
import { describe, expect, it } from 'vitest'
import { parseValue } from './api-validation.ts'
import { contractRoute } from './openapi.ts'

describe('contractRoute', () => {
  function worktreeApp(): { app: Hono; seen: unknown[] } {
    const app = new Hono()
    const seen: unknown[] = []
    contractRoute(app, 'sendWorktreePrompt', 'Worktrees', (c, input) => {
      seen.push(input)
      return c.json({ ok: true })
    })
    contractRoute(app, 'dismissNotification', 'Notifications', (c, input) => {
      seen.push(input)
      return c.json({ ok: true })
    })
    contractRoute(app, 'fetchRunEvents', 'Runs', (c, input) => {
      seen.push(input)
      return c.json({ events: [], nextCursor: null })
    })
    return { app, seen }
  }

  it('decodes encoded worktree names and validates the body before the handler runs', async () => {
    const { app, seen } = worktreeApp()

    const sent = await app.request('/api/worktrees/feature%2Fsearch/send', {
      method: 'POST',
      body: JSON.stringify({ text: 'Fix the failing tests' }),
    })

    expect(sent.status).toBe(200)
    expect(seen).toEqual([
      { params: { name: 'feature/search' }, query: undefined, body: { text: 'Fix the failing tests' } },
    ])
  })

  it('parses numeric route params and query cursors through the shared contract schemas', async () => {
    const { app, seen } = worktreeApp()

    await app.request('/api/notifications/42/dismiss', { method: 'POST' })
    await app.request('/api/runs/run_01/events?after=4')

    expect(seen).toEqual([
      { params: { id: 42 }, query: undefined, body: undefined },
      { params: { runId: 'run_01' }, query: { after: 4 }, body: undefined },
    ])
  })

  it('answers 400 for malformed JSON, invalid params and invalid bodies', async () => {
    const { app, seen } = worktreeApp()

    const malformed = await app.request('/api/worktrees/main/send', { method: 'POST', body: '{' })
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' })

    const params = await app.request('/api/notifications/abc/dismiss', { method: 'POST' })
    expect(params.status).toBe(400)

    const body = await app.request('/api/worktrees/main/send', { method: 'POST', body: '{}' })
    expect(await body.json()).toEqual({
      error: 'Invalid request body: text: Invalid input: expected string, received undefined',
    })
    expect(seen).toEqual([])
  })
})

describe('parseValue', () => {
  it('mentions additional validation errors after the first one', async () => {
    const schema = z.object({
      first: z.string(),
      second: z.string(),
    })

    const parsed = parseValue(schema, {}, 'Invalid path parameters')

    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('Expected validation to fail')

    expect(await parsed.response.json()).toEqual({
      error: 'Invalid path parameters: first: Invalid input: expected string, received undefined (and 1 more error)',
    })
  })
})

describe('CreateWorktreeRequestSchema linearTeamKey', () => {
  it('uppercases and accepts a valid team key', () => {
    const parsed = CreateWorktreeRequestSchema.safeParse({
      createLinearTicket: true,
      linearTeamKey: 'eng',
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.linearTeamKey).toBe('ENG')
  })

  it('rejects an issue-shaped key like ENG-123', () => {
    const parsed = CreateWorktreeRequestSchema.safeParse({
      createLinearTicket: true,
      linearTeamKey: 'ENG-123',
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects non-alpha characters', () => {
    const parsed = CreateWorktreeRequestSchema.safeParse({
      createLinearTicket: true,
      linearTeamKey: 'ENG2',
    })
    expect(parsed.success).toBe(false)
  })

  it('allows omitting linearTeamKey', () => {
    const parsed = CreateWorktreeRequestSchema.safeParse({})
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.linearTeamKey).toBeUndefined()
  })
})
