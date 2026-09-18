import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Semaphore } from '../../../../src/modules/taskflow/workflows/runtime/semaphore.ts'

const tick = () => new Promise((r) => setTimeout(r, 0))

test('ctor rejects non-positive / non-integer limits (M12)', () => {
  assert.throws(() => new Semaphore(0), RangeError)
  assert.throws(() => new Semaphore(-1), RangeError)
  assert.throws(() => new Semaphore(NaN), RangeError)
  assert.throws(() => new Semaphore(1.5), RangeError)
  // valid
  new Semaphore(1)
  new Semaphore(8)
})

test('never admits more than `limit` concurrently', async () => {
  const limit = 3
  const sem = new Semaphore(limit)
  let active = 0
  let peak = 0
  const tasks = Array.from({ length: 20 }, () =>
    sem.run(async () => {
      active++
      peak = Math.max(peak, active)
      await tick()
      active--
    }),
  )
  await Promise.all(tasks)
  assert.ok(peak <= limit, `peak ${peak} exceeded limit ${limit}`)
})

test('does NOT over-admit on the release/acquire handoff (M9)', async () => {
  // Regression for the handoff race: release() must hand the slot to the queued waiter without
  // decrementing active, or a fast-path acquire() racing in between yields limit+1 holders.
  const sem = new Semaphore(1)
  let active = 0
  let peak = 0
  const work = async () => {
    const release = await sem.acquire()
    active++
    peak = Math.max(peak, active)
    await tick()
    // Release, then immediately try to grab the slot again in the same microtask window — this is
    // the race that the buggy version lost.
    active--
    release()
    const r2 = await sem.acquire()
    active++
    peak = Math.max(peak, active)
    await tick()
    active--
    r2()
  }
  await Promise.all([work(), work(), work()])
  assert.equal(peak, 1)
})

test('mutex(1) strictly serializes (worktree mutex guarantee)', async () => {
  const sem = new Semaphore(1)
  const order: string[] = []
  let inside = 0
  const crit = (name: string) =>
    sem.run(async () => {
      inside++
      assert.equal(inside, 1, 'two holders in a mutex(1) critical section')
      order.push(`${name}:start`)
      await tick()
      order.push(`${name}:end`)
      inside--
    })
  await Promise.all([crit('a'), crit('b'), crit('c')])
  // each must fully complete before the next starts
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
})

test('FIFO ordering of queued waiters', async () => {
  const sem = new Semaphore(1)
  const order: number[] = []
  const release0 = await sem.acquire()
  // queue three waiters in order
  const p1 = sem.acquire().then((r) => {
    order.push(1)
    r()
  })
  const p2 = sem.acquire().then((r) => {
    order.push(2)
    r()
  })
  const p3 = sem.acquire().then((r) => {
    order.push(3)
    r()
  })
  release0()
  await Promise.all([p1, p2, p3])
  assert.deepEqual(order, [1, 2, 3])
})

test('release is idempotent (double-release does not over-admit)', async () => {
  const sem = new Semaphore(1)
  const release = await sem.acquire()
  release()
  release() // no-op
  let active = 0
  let peak = 0
  await Promise.all(
    Array.from({ length: 5 }, () =>
      sem.run(async () => {
        active++
        peak = Math.max(peak, active)
        await tick()
        active--
      }),
    ),
  )
  assert.equal(peak, 1)
})

test('run() releases the slot even if fn throws', async () => {
  const sem = new Semaphore(1)
  await assert.rejects(
    sem.run(async () => {
      throw new Error('boom')
    }),
  )
  // slot must be free again
  let ran = false
  await sem.run(async () => {
    ran = true
  })
  assert.ok(ran)
})
