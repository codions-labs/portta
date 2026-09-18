import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentSpec, JSONSchema } from '../../../../src/modules/taskflow/workflows/dsl/types.ts'
import { FakeWorker, synthesize } from '../../../../src/modules/taskflow/workflows/worker/fake.ts'
import {
  AgentError,
  AgentInterrupted,
  type WorkerContext,
  type WorkerProgress,
} from '../../../../src/modules/taskflow/workflows/worker/index.ts'
import { validate } from '../../../../src/modules/taskflow/workflows/worker/schema.ts'

function spec(overrides: Partial<AgentSpec> = {}): AgentSpec {
  return {
    prompt: 'do the thing',
    provider: 'codex',
    cwd: '/tmp',
    sandbox: 'read-only',
    approval: 'never',
    ...overrides,
  }
}

function makeCtx(signal?: AbortSignal): { ctx: WorkerContext; events: WorkerProgress[] } {
  const events: WorkerProgress[] = []
  const ctx: WorkerContext = {
    signal: signal ?? new AbortController().signal,
    onProgress: (e) => events.push(e),
  }
  return { ctx, events }
}

test('plain prompt → deterministic echo result', async () => {
  const w = new FakeWorker()
  const { ctx, events } = makeCtx()
  const r1 = await w.runAgent(spec({ prompt: 'hello world' }), ctx)
  const r2 = await w.runAgent(spec({ prompt: 'hello world' }), makeCtx().ctx)
  assert.equal(r1.status, 'completed')
  assert.equal(r1.text, r2.text) // deterministic
  assert.match(r1.text, /\[fake:codex\]/)
  assert.ok(events.some((e) => e.kind === 'reasoning'))
  assert.ok(events.some((e) => e.kind === 'text'))
  assert.ok(r1.usage.inputTokens > 0)
})

test("M7: schema'd call returns a value that validates (not a no-op)", async () => {
  const w = new FakeWorker()
  const schema: JSONSchema = {
    type: 'object',
    properties: { title: { type: 'string' }, count: { type: 'integer' } },
    required: ['title', 'count'],
  }
  const { ctx } = makeCtx()
  const r = await w.runAgent(spec({ schema }), ctx)
  assert.equal(r.status, 'completed')
  assert.equal(validate(schema, r.structured).ok, true)
  assert.equal(JSON.parse(r.text).title, (r.structured as { title?: unknown } | undefined)?.title)
})

test('M7: enum schema is satisfied (the bug the report cites)', async () => {
  const w = new FakeWorker()
  const schema: JSONSchema = {
    type: 'object',
    properties: { verdict: { enum: ['approve', 'reject'] } },
    required: ['verdict'],
  }
  const r = await w.runAgent(spec({ schema }), makeCtx().ctx)
  assert.equal(validate(schema, r.structured).ok, true)
  assert.equal((r.structured as Record<string, unknown>).verdict, 'approve')
})

test('M7: const, minItems, and numeric bounds are honored', async () => {
  const w = new FakeWorker()
  const schema: JSONSchema = {
    type: 'object',
    properties: {
      kind: { const: 'report' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 2 },
      score: { type: 'integer', minimum: 5, maximum: 10 },
    },
    required: ['kind', 'tags', 'score'],
  }
  const r = await w.runAgent(spec({ schema }), makeCtx().ctx)
  assert.equal(validate(schema, r.structured).ok, true)
  const s = r.structured as { kind: string; tags: string[]; score: number }
  assert.equal(s.kind, 'report')
  assert.ok(s.tags.length >= 2)
  assert.ok(s.score >= 5 && s.score <= 10)
})

test('M7: throws loudly when synthesis cannot satisfy the schema', async () => {
  const w = new FakeWorker()
  // An impossible constraint: minLength 5 but maxLength 2.
  const schema: JSONSchema = {
    type: 'object',
    properties: { x: { type: 'string', minLength: 5, maxLength: 2 } },
    required: ['x'],
  }
  await assert.rejects(
    () => w.runAgent(spec({ schema }), makeCtx().ctx),
    (err: unknown) => {
      assert.ok(err instanceof AgentError)
      assert.equal((err as AgentError).code, 'fake_schema_unsatisfiable')
      return true
    },
  )
})

test('L4: aborting during the delay rejects with AgentInterrupted (not a generic failure)', async () => {
  const w = new FakeWorker({ delayMs: 10_000 })
  const ac = new AbortController()
  const { ctx } = makeCtx(ac.signal)
  const p = w.runAgent(spec(), ctx)
  setImmediate(() => ac.abort())
  await assert.rejects(p, (err: unknown) => err instanceof AgentInterrupted)
})

test('L4: already-aborted signal returns immediately with AgentInterrupted (no full delay)', async () => {
  const w = new FakeWorker({ delayMs: 10_000 })
  const ac = new AbortController()
  ac.abort()
  const { ctx } = makeCtx(ac.signal)
  const start = Date.now()
  await assert.rejects(
    () => w.runAgent(spec(), ctx),
    (err: unknown) => err instanceof AgentInterrupted,
  )
  assert.ok(Date.now() - start < 1000, 'should not wait the full delay')
})

test('L4: delayed run completes when not aborted', async () => {
  const w = new FakeWorker({ delayMs: 5 })
  const r = await w.runAgent(spec(), makeCtx().ctx)
  assert.equal(r.status, 'completed')
})

test('synthesize: anyOf picks the first branch', () => {
  assert.equal(synthesize({ anyOf: [{ type: 'boolean' }, { type: 'string' }] }), false)
})

test('synthesize: exclusive bounds produce a value strictly inside the interval', () => {
  const v = synthesize({ type: 'integer', exclusiveMinimum: 5 }) as number
  assert.ok(v > 5)
  const w = synthesize({ type: 'integer', exclusiveMaximum: -3 }) as number
  assert.ok(w < -3)
})

test('synthesize: multipleOf is respected', () => {
  const v = synthesize({ type: 'integer', minimum: 7, multipleOf: 5 }) as number
  assert.equal(v % 5, 0)
  assert.ok(v >= 7)
})

test('synthesize: type-array picks a non-null type', () => {
  assert.equal(synthesize({ type: ['null', 'string'] }), 'fake')
})
