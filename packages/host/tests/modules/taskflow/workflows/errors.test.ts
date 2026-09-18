import assert from 'node:assert/strict'
import { test } from 'node:test'
import { withRetry } from '../../../../src/modules/taskflow/workflows/worker/errors.ts'
import { AgentError, AgentInterrupted } from '../../../../src/modules/taskflow/workflows/worker/index.ts'

const never = () => new AbortController().signal

test('withRetry: returns the first successful result without retrying', async () => {
  let calls = 0
  const r = await withRetry(async () => {
    calls++
    return 'ok'
  }, never())
  assert.equal(r, 'ok')
  assert.equal(calls, 1)
})

test('withRetry: retries retryable AgentErrors then succeeds', async () => {
  let calls = 0
  const r = await withRetry(
    async () => {
      calls++
      if (calls < 3) throw new AgentError({ provider: 'codex', code: 'overloaded', message: '529', retryable: true })
      return 'done'
    },
    never(),
    { baseMs: 1, maxMs: 2 },
  )
  assert.equal(r, 'done')
  assert.equal(calls, 3)
})

test('withRetry: does NOT retry a non-retryable AgentError', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++
          throw new AgentError({ provider: 'codex', code: 'error_max_turns', message: 'max turns', retryable: false })
        },
        never(),
        { baseMs: 1 },
      ),
    (err: unknown) => err instanceof AgentError && (err as AgentError).code === 'error_max_turns',
  )
  assert.equal(calls, 1)
})

test('withRetry: does NOT retry non-AgentError throws', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withRetry(async () => {
        calls++
        throw new TypeError('boom')
      }, never()),
    (err: unknown) => err instanceof TypeError,
  )
  assert.equal(calls, 1)
})

test('withRetry: gives up after `attempts` retryable failures and throws the last error', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls++
          throw new AgentError({ provider: 'codex', code: 'rate', message: `attempt ${calls}`, retryable: true })
        },
        never(),
        { attempts: 3, baseMs: 1, maxMs: 2 },
      ),
    (err: unknown) => err instanceof AgentError && (err as Error).message === 'attempt 3',
  )
  assert.equal(calls, 3)
})

test('L4: an already-aborted signal short-circuits before running fn', async () => {
  const ac = new AbortController()
  ac.abort()
  let calls = 0
  await assert.rejects(
    () =>
      withRetry(async () => {
        calls++
        return 'x'
      }, ac.signal),
    (err: unknown) => err instanceof AgentInterrupted,
  )
  assert.equal(calls, 0)
})

test('L4: aborting during the backoff sleep rejects with AgentInterrupted (no leaked listener hang)', async () => {
  const ac = new AbortController()
  let calls = 0
  const p = withRetry(
    async () => {
      calls++
      throw new AgentError({ provider: 'codex', code: 'overloaded', message: '529', retryable: true })
    },
    ac.signal,
    { attempts: 5, baseMs: 10_000, maxMs: 10_000 },
  )
  // First attempt runs, then we hit the long backoff sleep — abort it.
  setImmediate(() => ac.abort())
  await assert.rejects(p, (err: unknown) => err instanceof AgentInterrupted)
  assert.equal(calls, 1)
})
