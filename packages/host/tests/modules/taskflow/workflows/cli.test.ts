// Unit + smoke tests for the CLI: argument parsing, per-flag validation, error classification,
// the entrypoint symlink guard, and an end-to-end --fake spawn. Most commands run in-process via
// main(); only behavior that needs a real process (entrypoint error printing, signals, the bin
// symlink) spawns a CLI bundle built once. Filesystem-touching parts are scoped to a temp
// PORTTA_HOST_STATE_DIR (plus the temp bundle under node_modules/.cache); nothing here ever reads or
// writes the real ~/.portta/state/host.

import { strict as assert } from 'node:assert'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  browserOpenCommand,
  isUserFacingError,
  openBrowser,
  parseArgs,
  UsageError,
} from '../../../../src/modules/taskflow/workflows/cli.ts'
import {
  JournalNotFoundError,
  listRunIds,
  ResumePreconditionError,
} from '../../../../src/modules/taskflow/workflows/runtime/journal.ts'
import { WorkflowError } from '../../../../src/modules/taskflow/workflows/runtime/primitives.ts'
import { WorkflowNotFoundError } from '../../../../src/modules/taskflow/workflows/runtime/registry.ts'
import { WorkflowSyntaxError } from '../../../../src/modules/taskflow/workflows/runtime/sandbox.ts'
import { startViewer } from '../../../../src/modules/taskflow/workflows/server/serve.ts'
import { AgentError, AgentInterrupted } from '../../../../src/modules/taskflow/workflows/worker/index.ts'
import { type RunResult, runMain } from './run-main.ts'

describe('parseArgs — positionals', () => {
  test('collects bare positionals into _', () => {
    const f = parseArgs(['run', 'wf.js'])
    assert.deepEqual(f._, ['run', 'wf.js'])
  })

  test('empty argv yields empty _', () => {
    assert.deepEqual(parseArgs([])._, [])
  })

  test('everything after -- is positional', () => {
    const f = parseArgs(['run', '--', '--not-a-flag', 'x'])
    assert.deepEqual(f._, ['run', '--not-a-flag', 'x'])
  })
})

describe('parseArgs — value flags', () => {
  test('--flag value form', () => {
    const f = parseArgs(['run', '--provider', 'codex'])
    assert.equal(f.provider, 'codex')
    assert.deepEqual(f._, ['run'])
  })

  test('--flag=value form', () => {
    const f = parseArgs(['run', '--provider=codex'])
    assert.equal(f.provider, 'codex')
  })

  test("--flag=value preserves '=' inside the value", () => {
    const f = parseArgs(['run', '--args=a=b=c'])
    assert.equal(f.args, 'a=b=c')
  })

  test('--flag= sets an empty string (distinct from a missing flag)', () => {
    const f = parseArgs(['run', '--resume='])
    assert.equal(f.resume, '')
  })

  test('a value-taking flag with no value throws UsageError (M20: bare --resume)', () => {
    assert.throws(() => parseArgs(['run', '--resume']), UsageError)
  })

  test('a value-taking flag followed by another --flag throws (does not silently become true)', () => {
    assert.throws(() => parseArgs(['run', '--resume', '--fake']), UsageError)
  })

  test('a value-taking flag at end of argv throws', () => {
    assert.throws(() => parseArgs(['run', '--port']), UsageError)
  })
})

describe('parseArgs — boolean flags never consume the next token (M18)', () => {
  test('--fake does not swallow the following positional', () => {
    const f = parseArgs(['run', '--fake', 'wf.js'])
    assert.equal(f.fake, true)
    assert.deepEqual(f._, ['run', 'wf.js'])
  })

  test('--json, --open, --no-serve stay boolean and leave the next token alone', () => {
    const f = parseArgs(['run', '--json', '--open', '--no-serve', 'wf.js'])
    assert.equal(f.json, true)
    assert.equal(f.open, true)
    assert.equal(f['no-serve'], true)
    assert.deepEqual(f._, ['run', 'wf.js'])
  })

  test('--fake as the last token is true', () => {
    const f = parseArgs(['run', 'wf.js', '--fake'])
    assert.equal(f.fake, true)
  })

  test('--fake=true / --fake=false explicit forms', () => {
    assert.equal(parseArgs(['run', '--fake=true']).fake, true)
    assert.equal(parseArgs(['run', '--fake=false']).fake, false)
  })

  test('--fake=garbage throws UsageError', () => {
    assert.throws(() => parseArgs(['run', '--fake=garbage']), UsageError)
  })

  test('prune-stale / idle-shutdown / claude / agents are booleans', () => {
    const f = parseArgs(['runs', '--prune-stale', 'next'])
    assert.equal(f['prune-stale'], true)
    assert.deepEqual(f._, ['runs', 'next'])
  })
})

describe('isUserFacingError — typed classification (L17)', () => {
  test('UsageError is user-facing', () => {
    assert.equal(isUserFacingError(new UsageError('x')), true)
  })
  test('WorkflowSyntaxError is user-facing', () => {
    assert.equal(isUserFacingError(new WorkflowSyntaxError('x')), true)
  })
  test('WorkflowNotFoundError (unknown registry name) is user-facing', () => {
    assert.equal(isUserFacingError(new WorkflowNotFoundError('typo', ['deep-research'])), true)
  })
  test('WorkflowError is user-facing', () => {
    assert.equal(isUserFacingError(new WorkflowError('x')), true)
  })
  test('AgentError / AgentInterrupted are user-facing', () => {
    assert.equal(isUserFacingError(new AgentError({ provider: 'codex', code: 'x', message: 'y' })), true)
    assert.equal(isUserFacingError(new AgentInterrupted()), true)
  })
  test('determinism lint bare Error is user-facing by its stable prefix', () => {
    assert.equal(isUserFacingError(new Error('determinism lint failed: Date.now() → use now()')), true)
  })
  test('an arbitrary internal Error is NOT user-facing (would print a stack)', () => {
    assert.equal(isUserFacingError(new Error('Cannot read properties of undefined')), false)
  })
  test('a reworded user message is still classified by class, not prose', () => {
    // The old regex keyed on phrases like "must be the first statement"; a reword used to flip
    // these to a raw stack. Now the class decides regardless of wording.
    assert.equal(isUserFacingError(new WorkflowSyntaxError('totally different wording')), true)
  })
  test("JournalNotFoundError / ResumePreconditionError (typo'd --resume) are user-facing", () => {
    assert.equal(isUserFacingError(new JournalNotFoundError('wf_typo')), true)
    assert.equal(isUserFacingError(new ResumePreconditionError('workflow file changed')), true)
  })
  test('non-Error values are not user-facing (main prints String(err) for them anyway)', () => {
    assert.equal(isUserFacingError('a string'), false)
    assert.equal(isUserFacingError(undefined), false)
  })
})

describe('browserOpenCommand — platform forms (H13)', () => {
  test('darwin uses `open <url>`', () => {
    assert.deepEqual(browserOpenCommand('darwin', 'http://x/'), ['open', ['http://x/']])
  })
  test('win32 uses `cmd /c start "" <url>` (start is a cmd builtin, not an exe)', () => {
    assert.deepEqual(browserOpenCommand('win32', 'http://x/'), ['cmd', ['/c', 'start', '', 'http://x/']])
  })
  test('linux/other uses `xdg-open <url>`', () => {
    assert.deepEqual(browserOpenCommand('linux', 'http://x/'), ['xdg-open', ['http://x/']])
  })

  test('openBrowser never throws even when the opener binary is missing (H13)', async () => {
    // Strip PATH so the opener spawn ENOENTs. The async 'error' event must be swallowed, not crash
    // the process. We assert no unhandled error fires within a short window.
    const savedPath = process.env.PATH
    let unhandled: unknown
    const onUnhandled = (e: unknown): void => {
      unhandled = e
    }
    process.on('uncaughtException', onUnhandled)
    try {
      process.env.PATH = ''
      assert.doesNotThrow(() => openBrowser('http://127.0.0.1:1/'))
      await new Promise((r) => setTimeout(r, 200))
      assert.equal(unhandled, undefined)
    } finally {
      process.env.PATH = savedPath
      process.removeListener('uncaughtException', onUnhandled)
    }
  })
})

// --- helpers: env overrides for in-process runs, and spawning the built CLI bundle ---

/** Set env vars for the duration of `fn` (undefined deletes), restoring the previous values after. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]))
  const apply = (values: Record<string, string | undefined>): void => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
  apply(vars)
  try {
    return await fn()
  } finally {
    apply(saved)
  }
}

function runNode(nodeArgs: string[], env: Record<string, string> = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, nodeArgs, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/** Does GET /api/runs on this port answer 200? An independent probe of a claimed viewer URL. */
function apiUp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpGet({ host: '127.0.0.1', port, path: '/api/runs', timeout: 1000 }, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
  })
}

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000)
}

function writeSmokeWorkflow(dir: string): string {
  const wf = join(dir, 'smoke.workflow.js')
  writeFileSync(
    wf,
    `export const meta = { name: "smoke", description: "fake smoke test" }\n` + `return await agent("say hi")\n`,
  )
  return wf
}

describe('CLI run in-process (--fake)', () => {
  let home: string
  let wf: string
  const savedHome = process.env.PORTTA_HOST_STATE_DIR

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'taskflow-cli-test-'))
    wf = writeSmokeWorkflow(home)
    process.env.PORTTA_HOST_STATE_DIR = home
  })

  after(() => {
    if (savedHome === undefined) delete process.env.PORTTA_HOST_STATE_DIR
    else process.env.PORTTA_HOST_STATE_DIR = savedHome
    rmSync(home, { recursive: true, force: true })
  })

  test('invalid --provider is a UsageError (M5)', async () => {
    await assert.rejects(runMain(['run', wf, '--provider', 'claude', '--fake', '--no-serve']), {
      name: 'UsageError',
      message: /--provider must be one of/,
    })
  })

  test('--provider opencode and --provider pi are accepted (fake round-trip)', async () => {
    for (const provider of ['opencode', 'pi']) {
      const r = await runMain([
        'run',
        wf,
        '--provider',
        provider,
        '--model',
        'openrouter/foo/bar',
        '--fake',
        '--no-serve',
        '--json',
      ])
      assert.equal(r.code, 0, `stderr=${r.stderr}`)
      assert.equal(JSON.parse(r.stdout).status, 'completed')
    }
  })

  test('doctor resolves bins via env overrides and flags below-minimum versions as OUTDATED', {
    skip: process.platform === 'win32',
  }, async () => {
    // Stub binaries: opencode reports an outdated version, pi a current one. PATH points at an empty
    // dir so the codex/claude probes can never reach real binaries.
    const ocStub = join(home, 'fake-opencode')
    const piStub = join(home, 'fake-pi')
    writeFileSync(ocStub, '#!/bin/sh\necho 1.15.0\n')
    writeFileSync(piStub, '#!/bin/sh\necho 0.79.1\n')
    chmodSync(ocStub, 0o755)
    chmodSync(piStub, 0o755)
    const emptyPath = mkdtempSync(join(home, 'path-'))
    const r = await withEnv({ OPENCODE_BIN: ocStub, PI_BIN: piStub, CODEX_BIN: undefined, PATH: emptyPath }, () =>
      runMain(['doctor']),
    )
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stdout, /opencode\s+: 1\.15\.0 — OUTDATED \(< 1\.16\.2\)/)
    assert.match(r.stdout, /pi\s+: 0\.79\.1\n/)
    assert.doesNotMatch(r.stdout, /pi\s+: 0\.79\.1 — OUTDATED/)
  })

  test('doctor lists every ACP provider, declared ones included, and says where a missing command came from', {
    skip: process.platform === 'win32',
  }, async () => {
    // A project declaring `gemini` under providers:, run with cwd there (doctor reads the project
    // config from cwd). PATH is empty first so the declared command is NOT FOUND, then holds a stub.
    const project = mkdtempSync(join(home, 'acp-project-'))
    mkdirSync(join(project, '.portta'))
    writeFileSync(join(project, '.portta', 'taskflow.yaml'), 'providers:\n  gemini:\n    command: gemini-acp\n')
    const emptyPath = mkdtempSync(join(home, 'path-'))
    const binDir = mkdtempSync(join(home, 'bin-'))
    const stub = join(binDir, 'gemini-acp')
    writeFileSync(stub, '#!/bin/sh\nexit 0\n')
    chmodSync(stub, 0o755)
    const cwd = process.cwd()
    process.chdir(project)
    try {
      const missing = await withEnv({ PATH: emptyPath, CODEX_BIN: undefined }, () => runMain(['doctor']))
      assert.equal(missing.code, 0, `stderr=${missing.stderr}`)
      assert.match(missing.stdout, /acp codex\s+: /)
      assert.match(missing.stdout, /acp claude-code\s+: /)
      assert.match(missing.stdout, /acp opencode\s+: /)
      assert.match(missing.stdout, /acp pi\s+: /)
      assert.match(
        missing.stdout,
        /acp gemini\s+: NOT FOUND — declared in \.portta\/taskflow\.yaml; install "gemini-acp" or fix the command/,
      )

      const found = await withEnv({ PATH: binDir, CODEX_BIN: undefined }, () => runMain(['doctor']))
      assert.equal(found.code, 0, `stderr=${found.stderr}`)
      const row = found.stdout.split('\n').find((line) => /^\s+acp gemini\s+: /.test(line))
      assert.equal(row?.slice(row.indexOf(': ') + 2), stub, `expected the stub path in:\n${found.stdout}`)
    } finally {
      process.chdir(cwd)
    }
  })

  test('a meta.defaultProvider typo is rejected at run setup, even under --fake', async () => {
    const bad = join(home, 'bad-default-provider.workflow.js')
    writeFileSync(
      bad,
      `export const meta = { name: "bad", description: "typo'd provider", defaultProvider: "open-code", defaultModel: "m" }\n` +
        `return await agent("say hi")\n`,
    )
    await assert.rejects(runMain(['run', bad, '--fake', '--no-serve']), /invalid provider "open-code"/)
  })

  for (const [name, argv, message] of [
    ['invalid --sandbox (typo for read-only) is rejected (H14)', ['--sandbox', 'readonly'], /--sandbox must be one of/],
    [
      'invalid --concurrency (0) is rejected as not a positive integer (M12)',
      ['--concurrency', '0'],
      /--concurrency must be a positive integer/,
    ],
    [
      'invalid --concurrency (NaN) is rejected — would have hung the run forever (M12)',
      ['--concurrency', 'abc'],
      /--concurrency must be/,
    ],
    [
      'invalid --budget (abc → NaN) is rejected instead of silently disabling the budget (M20)',
      ['--budget', 'abc'],
      /--budget must be a non-negative number/,
    ],
    [
      "empty --budget= is rejected, not silently 0 (Number('') === 0)",
      ['--budget='],
      /--budget must be a non-negative number/,
    ],
    ['invalid --effort is rejected (M20)', ['--effort', 'turbo'], /--effort must be one of/],
    ['out-of-range --port is rejected', ['--port', '99999'], /--port must be an integer/],
    ['malformed --args JSON is a usage error', ['--args', '{not json}'], /--args is not valid JSON/],
  ] as const) {
    test(name, async () => {
      await assert.rejects(runMain(['run', wf, '--fake', '--no-serve', ...argv]), {
        name: 'UsageError',
        message,
      })
    })
  }

  test('when a viewer IS already up on the port, its URL is reused and claimed (M22)', async () => {
    const viewer = await startViewer({ port: 0, host: '127.0.0.1' })
    try {
      const port = new URL(viewer.url).port
      const r = await runMain(['run', wf, '--fake', '--json', '--port', port])
      assert.equal(r.code, 0, `stderr=${r.stderr}`)
      const out = JSON.parse(r.stdout)
      assert.equal(out.status, 'completed')
      assert.equal(out.url, `http://127.0.0.1:${port}/#/run/${out.runId}`)
    } finally {
      await viewer.close()
    }
  })
})

describe('CLI runs --prune --keep validation (H12)', () => {
  let home: string
  const savedHome = process.env.PORTTA_HOST_STATE_DIR
  const seeded = ['wf_aaaaaa', 'wf_bbbbbb', 'wf_cccccc']

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'taskflow-prune-test-'))
    process.env.PORTTA_HOST_STATE_DIR = home
    // Seed three run dirs with the minimum the lister/pruner inspects.
    for (const id of seeded) {
      const d = join(home, 'runs', id)
      mkdirSync(d, { recursive: true })
      writeFileSync(join(d, 'journal.jsonl'), '')
    }
  })

  after(() => {
    if (savedHome === undefined) delete process.env.PORTTA_HOST_STATE_DIR
    else process.env.PORTTA_HOST_STATE_DIR = savedHome
    rmSync(home, { recursive: true, force: true })
  })

  const assertAllRunsKept = (): void => {
    assert.deepEqual([...listRunIds()].sort(), seeded)
  }

  test('--prune --keep abc is rejected (would have NaN→slice(NaN)→delete ALL runs)', async () => {
    await assert.rejects(runMain(['runs', '--prune', '--keep', 'abc']), /--keep must be a non-negative integer/)
    assertAllRunsKept()
  })

  test('--prune --keep -1 (negative) is rejected', async () => {
    await assert.rejects(runMain(['runs', '--prune', '--keep=-1']), /--keep must be a non-negative integer/)
  })

  test("--prune --keep= (empty) is rejected — Number('') is 0, which would prune EVERYTHING", async () => {
    await assert.rejects(runMain(['runs', '--prune', '--keep=']), /--keep must be a non-negative integer/)
    assertAllRunsKept()
  })

  test('--prune --keep 10 keeps all three (fewer than the cap) and reports it', async () => {
    const r = await runMain(['runs', '--prune', '--keep', '10'])
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stdout, /pruned 0 run\(s\)/)
    assertAllRunsKept()
  })
})

describe('CLI misc commands', () => {
  test('unknown command exits 1', async () => {
    const r = await runMain(['frobnicate'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /Unknown command: frobnicate/)
  })

  test('run with no file prints usage and exits 1', async () => {
    const r = await runMain(['run'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /usage: portta flow workflows run/)
  })
})

describe('built CLI bundle (real process)', () => {
  // Bundle the CLI to a real .js once (what dist/cli.js is) for the cases that need a real process.
  // The bundle is written under node_modules/.cache so its external imports still resolve against
  // this repo's node_modules.
  const root = fileURLToPath(new URL('../../../../', import.meta.url))
  const posix = process.platform !== 'win32' // symlinkSync needs privileges on Windows
  let outDir = ''
  let home = ''
  let cli = ''
  let wf = ''

  before(() => {
    const { buildSync } = createRequire(import.meta.url)('esbuild') as typeof import('esbuild')
    const cache = join(root, 'node_modules', '.cache')
    mkdirSync(cache, { recursive: true })
    outDir = mkdtempSync(join(cache, 'taskflow-bin-test-'))
    cli = join(outDir, 'cli.js')
    buildSync({
      entryPoints: [join(root, 'src', 'modules', 'taskflow', 'workflows', 'cli.ts')],
      bundle: true,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      outfile: cli,
      logLevel: 'silent',
    })
    home = mkdtempSync(join(tmpdir(), 'taskflow-bin-home-'))
    wf = writeSmokeWorkflow(home)
  })

  after(() => {
    // Reap the detached idle-shutdown viewer the M22 test self-spawned. Match by argv (the unique
    // outDir path) rather than by port: an idle viewer closes its server, so a port lookup can
    // miss a process that hasn't exited yet. Best effort — pgrep exits 1 when nothing matches.
    if (posix && outDir) {
      try {
        const pids = execFileSync('pgrep', ['-f', outDir], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
        for (const pid of pids) process.kill(Number(pid), 'SIGTERM')
      } catch {
        // nothing to reap
      }
    }
    if (home) rmSync(home, { recursive: true, force: true })
    if (outDir) rmSync(outDir, { recursive: true, force: true })
  })

  test('run --fake <file> --no-serve --json runs a real workflow and emits JSON (M18: --fake not swallowed)', async () => {
    const r = await runNode(
      [cli, 'run', '--fake', wf, '--no-serve', '--json', '--effort', 'none', '--args', '{"x":1}'],
      { PORTTA_HOST_STATE_DIR: home },
    )
    assert.equal(r.code, 0, `nonzero exit; stderr=${r.stderr}`)
    const out = JSON.parse(r.stdout)
    assert.equal(out.status, 'completed')
    assert.match(out.runId, /^wf_/)
    assert.match(String(out.result), /fake/)
    // --no-serve means no viewer; URL must be absent rather than a dead link (M22).
    assert.equal(out.url, undefined)
  })

  test('a usage error exits 1 with a friendly message, not a stack (M5)', async () => {
    const r = await runNode([cli, 'run', wf, '--provider', 'claude', '--fake', '--no-serve'], {
      PORTTA_HOST_STATE_DIR: home,
    })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--provider must be one of/)
    assert.doesNotMatch(r.stderr, /at \w+ \(/) // no stack frames
  })

  test('serve closes and exits on the first SIGTERM (M19)', async () => {
    // A high, likely-free port; the test only cares that serve exits on the signal, not the port.
    const child = spawn(process.execPath, [cli, 'serve', '--port', String(randomPort())], {
      env: { ...process.env, PORTTA_HOST_STATE_DIR: home },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Wait for the "viewer: ..." banner so we know the server is listening before we signal it.
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('serve never printed its banner')), 8000)
      child.stderr.on('data', (d) => {
        if (String(d).includes('viewer:')) {
          clearTimeout(t)
          res()
        }
      })
      child.on('error', rej)
    })
    const exited = new Promise<number | null>((res) => child.on('close', (code) => res(code)))
    child.kill('SIGTERM')
    let timer: NodeJS.Timeout | undefined
    const code = await Promise.race([
      exited,
      new Promise<'timeout'>((res) => {
        timer = setTimeout(() => res('timeout'), 5000)
      }),
    ])
    clearTimeout(timer)
    if (code === 'timeout') {
      child.kill('SIGKILL')
      assert.fail('serve did not exit within 5s of a single SIGTERM')
    }
    // Process exited cleanly after the signal (close() resolved → main() returned).
    assert.ok(code === 0 || code === null, `unexpected exit code ${code}`)
  })

  describe('invoked through an npm-style bin symlink (M22/L17)', () => {
    // npm installs `bin` entries as SYMLINKS, and Node realpath-resolves the entry module — so
    // import.meta.url is the real cli file while argv[1] keeps the symlink path. The old entrypoint
    // guard compared the two as plain path strings, never matched through a symlink, and the
    // installed CLI exited 0 having printed NOTHING; ensureViewer's self-spawned `serve` child died
    // the same way (5s stall every run, viewer never auto-starting).
    let bin = ''

    before(() => {
      if (!posix) return
      bin = join(home, 'taskflow') // extension-less symlink, exactly like npm's bin install
      symlinkSync(cli, bin)
    })

    test('L17: the symlinked bin prints help — the old guard made it a silent exit-0 no-op', {
      skip: !posix,
    }, async () => {
      const r = await runNode([bin, 'help'])
      assert.equal(r.code, 0, `stderr=${r.stderr}`)
      assert.match(r.stdout, /Taskflow workflows — run JS workflow files/)
    })

    test('M22: run through the symlinked bin self-spawns the viewer and claims a LIVE url', {
      skip: !posix,
    }, async () => {
      const port = randomPort()
      const r = await runNode([bin, 'run', wf, '--fake', '--json', '--port', String(port)], {
        PORTTA_HOST_STATE_DIR: home,
      })
      assert.equal(r.code, 0, `stderr=${r.stderr}`)
      const out = JSON.parse(r.stdout)
      assert.equal(out.status, 'completed')
      // The url must be claimed (the self-spawn survived the symlink — the old guard silently killed
      // the child, stalling the full 5s poll and never starting a viewer) and must actually answer.
      assert.equal(out.url, `http://127.0.0.1:${port}/#/run/${out.runId}`)
      assert.equal(await apiUp(port), true, 'claimed url but /api/runs does not answer')
    })
  })
})
