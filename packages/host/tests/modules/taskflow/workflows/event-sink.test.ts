import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import { FileEventSink } from '../../../../src/modules/taskflow/workflows/runtime/event-sink.ts'
import type { WorkflowEvent } from '../../../../src/modules/taskflow/workflows/runtime/events.ts'
import { runDir } from '../../../../src/modules/taskflow/workflows/runtime/journal.ts'
import { JsonlWriter } from '../../../../src/modules/taskflow/workflows/runtime/jsonl-writer.ts'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'taskflow-es-'))
  process.env.PORTTA_HOST_STATE_DIR = home
})

afterEach(() => {
  delete process.env.PORTTA_HOST_STATE_DIR
  rmSync(home, { recursive: true, force: true })
})

function readEvents(runId: string): WorkflowEvent[] {
  const p = join(runDir(runId), 'events.jsonl')
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WorkflowEvent)
}

test('FileEventSink appends events with a timestamp and notifies listeners', async () => {
  const seen: WorkflowEvent[] = []
  const sink = new FileEventSink('r1', { listeners: [(e) => seen.push(e)], clock: () => 42 })
  sink.emit({ type: 'run', status: 'started', runId: 'r1' })
  sink.emit({ type: 'log', message: 'hi' })
  await sink.close()
  const events = readEvents('r1')
  assert.equal(events.length, 2)
  assert.equal(events[0]!.t, 42)
  assert.equal(events[0]!.type, 'run')
  assert.equal(events[1]!.type, 'log')
  assert.deepEqual(
    seen.map((e) => e.type),
    ['run', 'log'],
  )
})

test('M16: a throwing listener does not fail emit() or skip the remaining listeners', async () => {
  const seenA: string[] = []
  const seenC: string[] = []
  const sink = new FileEventSink('r2', {
    listeners: [
      (e) => seenA.push(e.type),
      () => {
        throw new Error('EPIPE on stderr')
      },
      (e) => seenC.push(e.type),
    ],
  })
  assert.doesNotThrow(() => sink.emit({ type: 'log', message: 'x' }))
  await sink.close()
  // the good listeners on both sides of the thrower still ran
  assert.deepEqual(seenA, ['log'])
  assert.deepEqual(seenC, ['log'])
  // and the event was still persisted
  assert.equal(readEvents('r2').length, 1)
})

test('FileEventSink creates the run dir if it does not exist', async () => {
  const sink = new FileEventSink('r3')
  sink.emit({ type: 'log', message: 'made dir' })
  await sink.close()
  assert.ok(existsSync(join(runDir('r3'), 'events.jsonl')))
})

test('H11: FileEventSink survives a stream error on events.jsonl without crashing the process', async () => {
  // Regression: pre-create events.jsonl as a DIRECTORY so the write stream errors (EISDIR).
  // On the old code the unhandled 'error' event crashed the run process.
  mkdirSync(join(runDir('r-broken'), 'events.jsonl'), { recursive: true })
  let crashed = false
  const onUncaught = (): void => {
    crashed = true
  }
  process.on('uncaughtException', onUncaught)
  try {
    const seen: string[] = []
    const sink = new FileEventSink('r-broken', { listeners: [(e) => seen.push(e.type)] })
    assert.doesNotThrow(() => sink.emit({ type: 'log', message: 'best effort' }))
    await new Promise((r) => setTimeout(r, 50))
    await sink.close()
    // listeners still observe events even though the file write failed
    assert.deepEqual(seen, ['log'])
  } finally {
    process.removeListener('uncaughtException', onUncaught)
  }
  assert.equal(crashed, false)
})

test('H11/L16: JsonlWriter degrades to best-effort on a stream error instead of crashing', async () => {
  // Point the writer at a path whose parent we then make impossible to write into by giving a path
  // that is itself a directory — createWriteStream emits an async 'error' (EISDIR).
  const dir = join(home, 'is-a-dir')
  mkdirSync(dir, { recursive: true })
  let captured: Error | undefined
  const w = new JsonlWriter(dir, {
    onError: (err) => {
      captured = err
    },
  })
  // Writing must not throw synchronously...
  assert.doesNotThrow(() => w.writeRecord({ a: 1 }))
  // ...and the async error is delivered to the handler, not the process.
  await new Promise((r) => setTimeout(r, 50))
  assert.ok(captured, 'onError received the stream error')
  await w.close()
})

test('H11: an unhandled process crash does not occur on a write error (no uncaughtException)', async () => {
  // Regression: the old code attached no 'error' handler, so this would crash the run process.
  let crashed = false
  const onUncaught = (): void => {
    crashed = true
  }
  process.on('uncaughtException', onUncaught)
  try {
    const dir = join(home, 'another-dir')
    mkdirSync(dir, { recursive: true })
    const w = new JsonlWriter(dir)
    w.writeRecord({ a: 1 })
    await new Promise((r) => setTimeout(r, 50))
    await w.close()
  } finally {
    process.removeListener('uncaughtException', onUncaught)
  }
  assert.equal(crashed, false)
})

test('L16: JsonlWriter swallows unserializable records instead of throwing', async () => {
  const p = join(home, 'rec.jsonl')
  const w = new JsonlWriter(p)
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.doesNotThrow(() => w.writeRecord(cyclic))
  // a subsequent good record still lands
  w.writeRecord({ ok: true })
  await w.close()
  const lines = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
  assert.equal(lines.length, 1)
  assert.deepEqual(JSON.parse(lines[0]!), { ok: true })
})

test("L16: JsonlWriter 'a' flag appends, 'w' flag truncates", async () => {
  const p = join(home, 'ap.jsonl')
  const a1 = new JsonlWriter(p, { flags: 'a' })
  a1.writeRecord({ n: 1 })
  await a1.close()
  const a2 = new JsonlWriter(p, { flags: 'a' })
  a2.writeRecord({ n: 2 })
  await a2.close()
  assert.equal(
    readFileSync(p, 'utf8')
      .split('\n')
      .filter((l) => l.trim()).length,
    2,
  )

  const w = new JsonlWriter(p, { flags: 'w' })
  w.writeRecord({ n: 3 })
  await w.close()
  const lines = readFileSync(p, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
  assert.equal(lines.length, 1)
  assert.deepEqual(JSON.parse(lines[0]!), { n: 3 })
})

test('L16: a throwing onError handler does not re-escalate', async () => {
  const dir = join(home, 'dir-err')
  mkdirSync(dir, { recursive: true })
  let crashed = false
  const onUncaught = (): void => {
    crashed = true
  }
  process.on('uncaughtException', onUncaught)
  try {
    const w = new JsonlWriter(dir, {
      onError: () => {
        throw new Error('handler also blew up')
      },
    })
    w.writeRecord({ a: 1 })
    await new Promise((r) => setTimeout(r, 50))
    await w.close()
  } finally {
    process.removeListener('uncaughtException', onUncaught)
  }
  assert.equal(crashed, false)
})
