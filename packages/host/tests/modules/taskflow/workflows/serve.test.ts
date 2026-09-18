// Tests for the read-only viewer server (src/server/serve.ts) and its tail helpers
// (src/server/tail.ts). Covers the fixed findings:
//   H15  cleanup registered before the initial replay (disconnect-during-replay)
//   H17  SSE id: byte-offset frames + Last-Event-ID resume (dedup-correct reconnect)
//   M23  fs.watch on a not-yet-existing directory retries / watches an ancestor
//   M24  chunked replay with partial-line carry (no whole-file alloc)
//   M25  listRuns caches summaries keyed by (size, mtime); deadman re-checked live
//   L20  malformed percent-encoding → 400, not 500
//   L21  startViewer surfaces idle via onIdle (no baked-in process.exit)
// Every filesystem test uses a fresh temp PORTTA_HOST_STATE_DIR; ~/.portta/state/host is never touched.

import { strict as assert } from 'node:assert'
import { appendFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { startViewer, type ViewerHandle } from '../../../../src/modules/taskflow/workflows/server/serve.ts'
import {
  nearestExistingDir,
  parseLastEventId,
  READ_CHUNK,
  readNewLines,
} from '../../../../src/modules/taskflow/workflows/server/tail.ts'

// ---------------------------------------------------------------------------
// Temp data dir scaffolding
// ---------------------------------------------------------------------------

let home: string

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'taskflow-serve-'))
  process.env.PORTTA_HOST_STATE_DIR = home
})

after(async () => {
  await rm(home, { recursive: true, force: true })
})

function runsRoot(): string {
  return join(home, 'runs')
}

async function freshHome(): Promise<void> {
  // Each describe block that mutates runs starts from a clean runs dir.
  await rm(runsRoot(), { recursive: true, force: true })
  await mkdir(runsRoot(), { recursive: true })
}

async function writeRun(runId: string, events: object[]): Promise<string> {
  const dir = join(runsRoot(), runId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, 'events.jsonl')
  await writeFile(file, `${events.map((e) => JSON.stringify(e)).join('\n')}\n`)
  return file
}

function runStarted(runId: string, t: number, workflowFile = '/tmp/demo.workflow.ts'): object {
  return { t, type: 'run', status: 'started', runId, workflowFile }
}
function runDone(runId: string, t: number): object {
  return { t, type: 'run', status: 'completed', runId }
}
function agentEv(index: number, state: string, t: number): object {
  return { t, type: 'agent', index, label: `a${index}`, provider: 'codex', state }
}

// ---------------------------------------------------------------------------
// SSE client helper — collects id: / data: frames until `until` is satisfied.
// ---------------------------------------------------------------------------

interface SseFrame {
  id?: string
  data?: unknown
}

interface SseConn {
  frames: SseFrame[]
  raw: string
  close: () => void
  req: http.ClientRequest
}

function frameAt(conn: SseConn, index: number): SseFrame {
  const frame = conn.frames[index]
  assert.ok(frame, `SSE frame ${index} not found`)
  return frame
}

function openSse(
  url: string,
  headers: Record<string, string> = {},
): {
  conn: SseConn
  waitFor: (pred: (c: SseConn) => boolean, timeoutMs?: number) => Promise<void>
} {
  const u = new URL(url)
  const conn: SseConn = { frames: [], raw: '', close: () => {}, req: undefined as unknown as http.ClientRequest }
  let buf = ''
  const req = http.request(
    {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { accept: 'text/event-stream', ...headers },
    },
    (res) => {
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        conn.raw += chunk
        buf += chunk
        let idx = buf.indexOf('\n\n')
        while (idx !== -1) {
          const block = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const frame: SseFrame = {}
          let isData = false
          for (const line of block.split('\n')) {
            if (line.startsWith('id: ')) frame.id = line.slice(4)
            else if (line.startsWith('data: ')) {
              isData = true
              try {
                frame.data = JSON.parse(line.slice(6))
              } catch {
                frame.data = line.slice(6)
              }
            }
          }
          if (isData) conn.frames.push(frame)
          idx = buf.indexOf('\n\n')
        }
      })
    },
  )
  conn.req = req
  conn.close = () => {
    req.destroy()
  }
  req.on('error', () => {})
  req.end()

  const waitFor = async (pred: (c: SseConn) => boolean, timeoutMs = 3000): Promise<void> => {
    const start = Date.now()
    while (!pred(conn)) {
      if (Date.now() - start > timeoutMs)
        throw new Error(`SSE waitFor timed out; frames=${JSON.stringify(conn.frames)} raw=${conn.raw.slice(0, 200)}`)
      await delay(15)
    }
  }

  return { conn, waitFor }
}

// ===========================================================================
// Pure helper: readNewLines (M24, H17 offsets)
// ===========================================================================

describe('readNewLines', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskflow-tail-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('missing file yields no lines, unchanged offset', async () => {
    const r = await readNewLines(join(dir, 'nope.jsonl'), 0, Buffer.alloc(0))
    assert.deepEqual(r.lines, [])
    assert.equal(r.offset, 0)
    assert.equal(r.reset, false)
  })

  test('reads whole lines and tags each with the byte offset past its newline', async () => {
    const f = join(dir, 'a.jsonl')
    const l1 = JSON.stringify({ n: 1 })
    const l2 = JSON.stringify({ n: 2 })
    await writeFile(f, `${l1}\n${l2}\n`)
    const r = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r.lines.length, 2)
    assert.equal(r.lines[0]?.line, l1)
    assert.equal(r.lines[0]?.offset, Buffer.byteLength(l1) + 1)
    assert.equal(r.lines[1]?.line, l2)
    assert.equal(r.lines[1]?.offset, Buffer.byteLength(l1) + 1 + Buffer.byteLength(l2) + 1)
    assert.equal(r.offset, Buffer.byteLength(`${l1}\n${l2}\n`))
    assert.equal(r.pending.length, 0)
  })

  test('carries a partial last line across calls and resumes from the returned offset', async () => {
    const f = join(dir, 'b.jsonl')
    await writeFile(f, '{"n":1}\n{"n":2')
    const r1 = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r1.lines.length, 1)
    assert.equal(r1.lines[0]?.line, '{"n":1}')
    assert.equal(r1.pending.toString('utf8'), '{"n":2')
    // Append the rest of line 2 plus a line 3.
    await appendFile(f, '}\n{"n":3}\n')
    const r2 = await readNewLines(f, r1.offset, r1.pending)
    assert.equal(r2.lines.length, 2)
    assert.equal(r2.lines[0]?.line, '{"n":2}')
    assert.equal(r2.lines[1]?.line, '{"n":3}')
    assert.equal(r2.pending.length, 0)
  })

  test('offset accounts for multibyte UTF-8 so resume bytes are exact', async () => {
    const f = join(dir, 'utf.jsonl')
    const l1 = JSON.stringify({ s: 'héllo' }) // multibyte é
    const l2 = JSON.stringify({ s: 'wörld' })
    await writeFile(f, `${l1}\n${l2}\n`)
    const r = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r.lines[0]?.offset, Buffer.byteLength(l1) + 1)
    // Resuming from the first line's offset must yield exactly line 2 (no corruption).
    const r2 = await readNewLines(f, r.lines[0]?.offset, Buffer.alloc(0))
    assert.equal(r2.lines.length, 1)
    assert.equal(r2.lines[0]?.line, l2)
  })

  test('multibyte char straddling a READ_CHUNK boundary decodes intact (no U+FFFD)', async () => {
    const f = join(dir, 'boundary.jsonl')
    const prefix = '{"s":"'
    // Position a 2-byte "é" so its first byte is the last byte of the first chunk read.
    const padLen = READ_CHUNK - 1 - Buffer.byteLength(prefix)
    const value = `${'x'.repeat(padLen)}é`
    const l1 = `${prefix + value}"}`
    const l2 = '{"n":2}'
    await writeFile(f, `${l1}\n${l2}\n`)
    const r = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r.lines.length, 2)
    assert.ok(!r.lines[0]?.line.includes('�'), 'chunk boundary must not corrupt multibyte chars')
    assert.deepEqual(JSON.parse(r.lines[0]!.line), { s: value })
    assert.equal(r.lines[0]?.offset, Buffer.byteLength(l1) + 1)
    assert.equal(r.lines[1]?.line, l2)
  })

  test('shrink/rotation resets to byte 0 and reports reset', async () => {
    const f = join(dir, 'rot.jsonl')
    await writeFile(f, '{"n":1}\n{"n":2}\n')
    const r1 = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r1.lines.length, 2)
    // Truncate to a smaller file.
    await writeFile(f, '{"n":9}\n')
    const r2 = await readNewLines(f, r1.offset, r1.pending)
    assert.equal(r2.reset, true)
    assert.equal(r2.lines.length, 1)
    assert.equal(r2.lines[0]?.line, '{"n":9}')
  })

  test('reads files larger than one chunk via bounded reads (M24)', async () => {
    const f = join(dir, 'big.jsonl')
    // Pad each line so the file comfortably exceeds two READ_CHUNKs regardless of count.
    const pad = 'x'.repeat(200)
    const n = Math.ceil((READ_CHUNK * 2.5) / 210)
    const lines: string[] = []
    for (let i = 0; i < n; i++) lines.push(JSON.stringify({ i, pad }))
    await writeFile(f, `${lines.join('\n')}\n`)
    const total = (await stat(f)).size
    assert.ok(total > READ_CHUNK * 2, `fixture should exceed two chunks (got ${total} vs ${READ_CHUNK * 2})`)
    const r = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r.lines.length, n)
    assert.equal(r.lines[0]?.line, JSON.stringify({ i: 0, pad }))
    assert.equal(r.lines[n - 1]?.line, JSON.stringify({ i: n - 1, pad }))
    assert.equal(r.offset, total)
  })

  test('skips blank lines but counts their bytes in the offset', async () => {
    const f = join(dir, 'blank.jsonl')
    await writeFile(f, '{"n":1}\n\n{"n":2}\n')
    const r = await readNewLines(f, 0, Buffer.alloc(0))
    assert.equal(r.lines.length, 2)
    assert.equal(r.lines[1]?.line, '{"n":2}')
    // The blank line's byte (its "\n") is included in the consumed offset.
    assert.equal(r.offset, Buffer.byteLength('{"n":1}\n\n{"n":2}\n'))
  })
})

// ===========================================================================
// Pure helpers: nearestExistingDir (M23) + parseLastEventId (H17)
// ===========================================================================

describe('nearestExistingDir', () => {
  let dir: string
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taskflow-near-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('returns the dir itself when it exists', async () => {
    assert.equal(await nearestExistingDir(dir), dir)
  })

  test('returns the nearest existing ancestor for a missing leaf', async () => {
    const missing = join(dir, 'a', 'b', 'c')
    assert.equal(await nearestExistingDir(missing), dir)
  })

  test('updates once a previously-missing dir is created', async () => {
    const leaf = join(dir, 'later', 'deep')
    assert.equal(await nearestExistingDir(leaf), dir)
    await mkdir(leaf, { recursive: true })
    assert.equal(await nearestExistingDir(leaf), leaf)
  })
})

describe('parseLastEventId', () => {
  test('absent / empty / malformed → 0', () => {
    assert.equal(parseLastEventId(undefined), 0)
    assert.equal(parseLastEventId(''), 0)
    assert.equal(parseLastEventId('  '), 0)
    assert.equal(parseLastEventId('abc'), 0)
    assert.equal(parseLastEventId('-5'), 0)
    assert.equal(parseLastEventId('1.5'), 0)
  })
  test('non-negative integer string → that number', () => {
    assert.equal(parseLastEventId('0'), 0)
    assert.equal(parseLastEventId('42'), 42)
    assert.equal(parseLastEventId(' 100 '), 100)
  })
  test('array header takes the first value', () => {
    assert.equal(parseLastEventId(['7', '9']), 7)
    assert.equal(parseLastEventId([]), 0)
  })
})

// ===========================================================================
// HTTP server integration
// ===========================================================================

describe('startViewer HTTP', () => {
  let viewer: ViewerHandle

  before(async () => {
    await freshHome()
    viewer = await startViewer({ port: 0, host: '127.0.0.1' })
  })
  after(async () => {
    await viewer.close()
  })

  async function get(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
    const u = new URL(path, viewer.url)
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers },
        (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (c) => (body += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        },
      )
      req.on('error', reject)
      req.end()
    })
  }

  test('GET /api/runs lists runs newest-first', async () => {
    await writeRun('run-old', [runStarted('run-old', 1000), agentEv(0, 'done', 1001), runDone('run-old', 1002)])
    await writeRun('run-new', [runStarted('run-new', 5000), agentEv(0, 'done', 5001), runDone('run-new', 5002)])
    const { status, body } = await get('/api/runs')
    assert.equal(status, 200)
    const list = JSON.parse(body) as Array<{ runId: string; status: string; agents: number }>
    assert.equal(list[0]?.runId, 'run-new')
    assert.equal(list[1]?.runId, 'run-old')
    assert.equal(list[0]?.status, 'completed')
    assert.equal(list[0]?.agents, 1)
  })

  test('GET /api/runs/:id returns a folded snapshot; missing → 404', async () => {
    await writeRun('snap', [runStarted('snap', 2000), agentEv(3, 'running', 2001)])
    const ok = await get('/api/runs/snap')
    assert.equal(ok.status, 200)
    const snap = JSON.parse(ok.body) as { runId: string; agents: Array<{ index: number; state: string }> }
    assert.equal(snap.runId, 'snap')
    assert.equal(snap.agents[0]?.index, 3)
    assert.equal(snap.agents[0]?.state, 'running')

    const missing = await get('/api/runs/does-not-exist')
    assert.equal(missing.status, 404)
  })

  test('declared phases fold as pending until entered; pending never downgrades a started phase', async () => {
    await writeRun('phased', [
      runStarted('phased', 3000),
      { t: 3001, type: 'phase', index: 1, title: 'Scan', pending: true },
      { t: 3001, type: 'phase', index: 2, title: 'Fix', pending: true },
      { t: 3002, type: 'phase', index: 1, title: 'Scan' }, // entered
      {
        t: 3003,
        type: 'agent',
        index: 0,
        label: 'a0',
        provider: 'codex',
        state: 'running',
        phaseIndex: 1,
        phaseTitle: 'Scan',
      },
      // A resume appends a fresh pending announcement AFTER the phase already started — it
      // must not flip the phase back to pending.
      { t: 3004, type: 'phase', index: 1, title: 'Scan', pending: true },
    ])
    const { body } = await get('/api/runs/phased')
    const snap = JSON.parse(body) as {
      phases: Array<{ index: number; title: string; pending: boolean; agents: unknown[] }>
    }
    assert.equal(snap.phases.length, 2)
    assert.equal(snap.phases[0]?.title, 'Scan')
    assert.equal(snap.phases[0]?.pending, false)
    assert.equal(snap.phases[0]?.agents.length, 1)
    assert.equal(snap.phases[1]?.title, 'Fix')
    assert.equal(snap.phases[1]?.pending, true)
    assert.equal(snap.phases[1]?.agents.length, 0)
  })

  test('L20: malformed percent-encoding → 400, not 500', async () => {
    for (const bad of ['/api/runs/%', '/api/runs/%zz', '/api/runs/%E0%A4%A/stream', '/api/runs/%/agents/0']) {
      const { status } = await get(bad)
      assert.equal(status, 400, `expected 400 for ${bad}, got ${status}`)
    }
  })

  test('invalid run id (traversal) → 400', async () => {
    const { status } = await get('/api/runs/..%2Fetc')
    assert.equal(status, 400)
  })

  test('method other than GET/HEAD → 405', async () => {
    const u = new URL('/api/runs', viewer.url)
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST' }, (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      })
      req.on('error', reject)
      req.end()
    })
    assert.equal(status, 405)
  })

  test("deadman: a 'started' run with a stale heartbeat reports 'stale'", async () => {
    const runId = 'stale-run'
    await writeRun(runId, [runStarted(runId, Date.now() - 60_000), agentEv(0, 'running', Date.now() - 60_000)])
    // Heartbeat file far in the past → stale.
    const hb = join(runsRoot(), runId, '.heartbeat')
    await writeFile(hb, 'x')
    const old = new Date(Date.now() - 60_000)
    await utimes(hb, old, old)
    const { body } = await get(`/api/runs/${runId}`)
    assert.equal((JSON.parse(body) as { status: string }).status, 'stale')
    const list = JSON.parse((await get('/api/runs')).body) as Array<{ runId: string; status: string }>
    assert.equal(list.find((r) => r.runId === runId)?.status, 'stale')
  })
})

// ===========================================================================
// SSE replay + tail + Last-Event-ID resume (H17) + cleanup (H15)
// ===========================================================================

describe('SSE streaming', () => {
  let viewer: ViewerHandle

  before(async () => {
    await freshHome()
    viewer = await startViewer({ port: 0, host: '127.0.0.1' })
  })
  after(async () => {
    await viewer.close()
  })

  test('replays existing lines with monotonic id: byte offsets, then tails appends', async () => {
    const runId = 'stream-1'
    const file = await writeRun(runId, [runStarted(runId, 1), agentEv(0, 'running', 2)])
    const { conn, waitFor } = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href)
    await waitFor((c) => c.frames.length >= 2)
    assert.equal((frameAt(conn, 0).data as { type: string }).type, 'run')
    assert.equal((frameAt(conn, 1).data as { type: string }).type, 'agent')
    // ids are byte offsets — strictly increasing, equal to the file size after each line.
    const id0 = Number(conn.frames[0]?.id)
    const id1 = Number(conn.frames[1]?.id)
    assert.ok(id1 > id0)
    assert.equal(id1, (await stat(file)).size)

    // Append a new line; the tail should deliver it.
    await appendFile(file, `${JSON.stringify(agentEv(0, 'done', 3))}\n`)
    await waitFor((c) => c.frames.length >= 3)
    assert.equal((frameAt(conn, 2).data as { state: string }).state, 'done')
    assert.equal(Number(conn.frames[2]?.id), (await stat(file)).size)
    conn.close()
  })

  test('H17: Last-Event-ID resume replays only newer lines (no duplicates)', async () => {
    const runId = 'resume-1'
    const file = await writeRun(runId, [runStarted(runId, 1), agentEv(0, 'running', 2), agentEv(1, 'running', 3)])

    // First client reads everything, records the last id.
    const first = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href)
    await first.waitFor((c) => c.frames.length >= 3)
    const lastId = frameAt(first.conn, 2).id
    assert.ok(lastId, 'last replayed SSE frame has no id')
    first.conn.close()
    await delay(50)

    // Append two more lines while "disconnected".
    await appendFile(file, `${JSON.stringify(agentEv(0, 'done', 4))}\n`)
    await appendFile(file, `${JSON.stringify(agentEv(1, 'done', 5))}\n`)

    // Reconnect with Last-Event-ID = lastId — should get ONLY the two new lines.
    const second = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href, { 'last-event-id': lastId })
    await second.waitFor((c) => c.frames.length >= 2)
    await delay(100) // give any erroneous extra frames a chance to arrive
    assert.equal(second.conn.frames.length, 2, 'resume must not re-send already-seen lines')
    assert.equal((frameAt(second.conn, 0).data as { index: number; state: string }).state, 'done')
    assert.equal((frameAt(second.conn, 0).data as { index: number }).index, 0)
    assert.equal((frameAt(second.conn, 1).data as { index: number }).index, 1)
    second.conn.close()
  })

  test('H17: Last-Event-ID past EOF replays nothing until new appends', async () => {
    const runId = 'resume-eof'
    const file = await writeRun(runId, [runStarted(runId, 1)])
    const size = (await stat(file)).size
    const conn = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href, { 'last-event-id': String(size) })
    await delay(150)
    assert.equal(conn.conn.frames.length, 0)
    await appendFile(file, `${JSON.stringify(agentEv(0, 'done', 2))}\n`)
    await conn.waitFor((c) => c.frames.length >= 1)
    assert.equal((frameAt(conn.conn, 0).data as { type: string }).type, 'agent')
    conn.conn.close()
  })

  test('truncation mid-stream resets to byte 0 and replays the new content', async () => {
    const runId = 'trunc-1'
    const file = await writeRun(runId, [runStarted(runId, 1), agentEv(0, 'running', 2)])
    const { conn, waitFor } = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href)
    await waitFor((c) => c.frames.length >= 2)

    // Rewrite the file smaller (rotation). The tail must restart from byte 0 and deliver
    // the new content with ids restarting at the new line boundaries.
    await writeFile(file, `${JSON.stringify(runStarted(runId, 9))}\n`)
    await waitFor((c) => c.frames.length >= 3, 5000)
    const replayed = conn.frames[2]!
    assert.equal((replayed.data as { t: number }).t, 9)
    assert.equal(Number(replayed.id), (await stat(file)).size)
    conn.close()
  })

  test('H15: disconnecting during a large replay cleans up (idle becomes reachable again)', async () => {
    const runId = 'big-replay'
    // Build a multi-chunk file so the initial drain spans multiple awaits.
    const dir = join(runsRoot(), runId)
    await mkdir(dir, { recursive: true })
    const file = join(dir, 'events.jsonl')
    const lines: string[] = [JSON.stringify(runStarted(runId, 1))]
    for (let i = 0; i < 8000; i++) lines.push(JSON.stringify({ t: i + 2, type: 'log', message: 'x'.repeat(40) }))
    await writeFile(file, `${lines.join('\n')}\n`)
    assert.ok((await stat(file)).size > READ_CHUNK * 2)

    // Open several connections and abort them mid-replay. With cleanup registered AFTER the
    // drain (the old bug) the close event has no listener, so sseClients stays inflated and
    // the (process-wide) idle watcher below would never fire. sseClients is module-shared
    // across startViewer instances, so a fresh idleShutdown viewer is a faithful probe.
    for (let i = 0; i < 6; i++) {
      const c = openSse(new URL(`/api/runs/${runId}/stream`, viewer.url).href)
      await delay(2) // let the response start before we kill it
      c.conn.close()
    }
    let idled = false
    const idleViewer = await startViewer({
      port: 0,
      host: '127.0.0.1',
      idleShutdown: true,
      idleMs: 10,
      idleCheckMs: 20,
      onIdle: () => {
        idled = true
      },
    })
    const start = Date.now()
    while (!idled && Date.now() - start < 3000) await delay(20)
    await idleViewer.close().catch(() => {})
    assert.equal(idled, true, 'leaked mid-replay connections must be cleaned up so idle is reachable')
  })
})

// ===========================================================================
// M23: stream opened before the agents/ dir exists still delivers
// ===========================================================================

describe('M23: missing-dir watch', () => {
  let viewer: ViewerHandle

  before(async () => {
    await freshHome()
    viewer = await startViewer({ port: 0, host: '127.0.0.1' })
  })
  after(async () => {
    await viewer.close()
  })

  test('agent stream opened before agents/ dir exists delivers once the file appears', async () => {
    const runId = 'lazy-agent'
    // Run dir exists (events emitted) but agents/ does NOT yet.
    await writeRun(runId, [runStarted(runId, 1), agentEv(0, 'running', 2)])
    const agentsDir = join(runsRoot(), runId, 'agents')

    const { conn, waitFor } = openSse(new URL(`/api/runs/${runId}/agents/0/stream`, viewer.url).href)
    // Nothing yet — the dir doesn't exist.
    await delay(150)
    assert.equal(conn.frames.length, 0)

    // Now the runtime creates the dir + transcript and writes a chunk.
    await mkdir(agentsDir, { recursive: true })
    await delay(120) // let the ancestor watcher / poll pick up the new dir
    await writeFile(join(agentsDir, '0.jsonl'), `${JSON.stringify({ t: 3, kind: 'status', state: 'running' })}\n`)

    await waitFor((c) => c.frames.length >= 1, 5000)
    assert.equal((frameAt(conn, 0).data as { kind: string }).kind, 'status')
    conn.close()
  })

  test('agent stream opened before the WHOLE run dir exists still delivers', async () => {
    const runId = 'lazy-run'
    const { conn, waitFor } = openSse(new URL(`/api/runs/${runId}/agents/0/stream`, viewer.url).href)
    await delay(120)
    assert.equal(conn.frames.length, 0)

    const agentsDir = join(runsRoot(), runId, 'agents')
    await mkdir(agentsDir, { recursive: true })
    await delay(160)
    await writeFile(join(agentsDir, '0.jsonl'), `${JSON.stringify({ t: 1, kind: 'text', text: 'hi' })}\n`)

    await waitFor((c) => c.frames.length >= 1, 5000)
    assert.equal((frameAt(conn, 0).data as { kind: string }).kind, 'text')
    conn.close()
  })
})

// ===========================================================================
// M25: listRuns summary cache keyed by (size, mtime)
// ===========================================================================

describe('M25: listRuns caching + live deadman', () => {
  let viewer: ViewerHandle

  before(async () => {
    await freshHome()
    viewer = await startViewer({ port: 0, host: '127.0.0.1' })
  })
  after(async () => {
    await viewer.close()
  })

  async function listStatus(runId: string): Promise<string | undefined> {
    const u = new URL('/api/runs', viewer.url)
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'GET' }, (res) => {
        let b = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (b += c))
        res.on('end', () => resolve(b))
      })
      req.on('error', reject)
      req.end()
    })
    const list = JSON.parse(body) as Array<{ runId: string; status: string }>
    return list.find((r) => r.runId === runId)?.status
  }

  test('repeat polls return consistent results and reflect appended events', async () => {
    const runId = 'cache-run'
    const file = await writeRun(runId, [runStarted(runId, Date.now()), agentEv(0, 'running', Date.now())])
    // First poll: live (fresh heartbeat absent → falls back to startedAt = now, not stale).
    assert.equal(await listStatus(runId), 'started')
    // Second poll, file unchanged → cache hit, still consistent.
    assert.equal(await listStatus(runId), 'started')
    // Append a terminal event → file (size/mtime) changes → cache invalidated → completed.
    await appendFile(file, `${JSON.stringify(runDone(runId, Date.now()))}\n`)
    assert.equal(await listStatus(runId), 'completed')
  })

  test("a cached 'started' run flips to 'stale' once its heartbeat ages (deadman not stale-cached)", async () => {
    const runId = 'cache-stale'
    // startedAt in the past: liveness is then governed by the heartbeat (the deadman's intent).
    await writeRun(runId, [runStarted(runId, Date.now() - 60_000), agentEv(0, 'running', Date.now() - 60_000)])
    const hb = join(runsRoot(), runId, '.heartbeat')
    await writeFile(hb, 'x') // fresh beat → live despite the old startedAt
    assert.equal(await listStatus(runId), 'started')
    // Age the heartbeat past STALE_MS without touching events.jsonl (cache key unchanged):
    // the cached "started" fold must still re-derive staleness from the live heartbeat.
    const old = new Date(Date.now() - 60_000)
    await utimes(hb, old, old)
    assert.equal(await listStatus(runId), 'stale')
  })
})

// ===========================================================================
// L21: idle shutdown surfaced via onIdle (no process.exit baked in)
// ===========================================================================

describe('L21: idle shutdown via onIdle', () => {
  beforeEach(async () => {
    await freshHome()
  })

  test('fires onIdle once there is no SSE client and no started run', async () => {
    let idleHandle: ViewerHandle | undefined
    const viewer = await startViewer({
      port: 0,
      host: '127.0.0.1',
      idleShutdown: true,
      idleMs: 10,
      idleCheckMs: 20,
      onIdle: (h) => {
        idleHandle = h
      },
    })
    // Wait for the idle callback.
    const start = Date.now()
    while (!idleHandle && Date.now() - start < 3000) await delay(20)
    assert.ok(idleHandle, 'onIdle should have fired')
    assert.equal(idleHandle?.url, viewer.url)
    await viewer.close()
  })

  test("does NOT fire onIdle while a run is still 'started'", async () => {
    const runId = 'busy'
    await writeRun(runId, [runStarted(runId, Date.now())])
    const hb = join(runsRoot(), runId, '.heartbeat')
    await writeFile(hb, 'x') // fresh heartbeat keeps it live
    let fired = false
    const viewer = await startViewer({
      port: 0,
      host: '127.0.0.1',
      idleShutdown: true,
      idleMs: 10,
      idleCheckMs: 20,
      onIdle: () => {
        fired = true
      },
    })
    await delay(80)
    assert.equal(fired, false, 'an active run must keep the viewer alive')
    await viewer.close()
  })

  test('close() resolves and stops serving', async () => {
    const viewer = await startViewer({ port: 0, host: '127.0.0.1' })
    await viewer.close()
    // A request after close should fail to connect.
    const u = new URL('/api/runs', viewer.url)
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, timeout: 500 }, (res) => {
          res.resume()
          resolve(res.statusCode)
        })
        req.on('error', reject)
        req.on('timeout', () => req.destroy(new Error('timeout')))
        req.end()
      }),
    )
  })
})
