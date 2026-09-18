import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NodeProcessRunner } from '../../../src/modules/taskflow/adapters/process-runner.ts'

async function text(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

test('ProcessRunner drains stdin, stdout, stderr, env, and exit', async () => {
  const runner = new NodeProcessRunner()
  const running = runner.start({
    command: process.execPath,
    args: [
      '-e',
      "process.stdin.on('data', value => { process.stdout.write(value); process.stderr.write(process.env.PROCESS_RUNNER_SECRET ?? ''); });",
    ],
    stdin: 'payload',
    env: { PROCESS_RUNNER_SECRET: 'secret-value' },
  })
  const [stdout, stderr, exited] = await Promise.all([text(running.stdout), text(running.stderr), running.exited])
  assert.equal(stdout, 'payload')
  assert.equal(stderr, 'secret-value')
  assert.deepEqual(exited, { code: 0, signal: null, timedOut: false })
})

test('ProcessRunner drains large output and terminates a timeout', async () => {
  const runner = new NodeProcessRunner()
  const running = runner.start({
    command: process.execPath,
    args: ['-e', "process.stdout.write('x'.repeat(200000)); setTimeout(() => {}, 1000);"],
    timeoutMs: 100,
    graceMs: 10,
  })
  const [stdout, exited] = await Promise.all([text(running.stdout), running.exited])
  assert.equal(stdout.length, 200000)
  assert.equal(exited.timedOut, true)
})

test('ProcessRunner honors AbortSignal', async () => {
  const controller = new AbortController()
  const runner = new NodeProcessRunner()
  const running = runner.start({
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 1000)'],
    signal: controller.signal,
    graceMs: 10,
  })
  controller.abort()
  const exited = await running.exited
  assert.equal(exited.timedOut, false)
  assert.equal(exited.signal, 'SIGTERM')
})

test('ProcessRunner keeps stdin available when requested', async () => {
  const runner = new NodeProcessRunner()
  const running = runner.start({
    command: process.execPath,
    args: ['-e', "process.stdin.on('data', value => process.stdout.write(value));"],
    keepStdinOpen: true,
  })
  await running.writeStdin('first')
  await running.writeStdin('second')
  running.closeStdin()
  const [stdout, exited] = await Promise.all([text(running.stdout), running.exited])
  assert.equal(stdout, 'firstsecond')
  assert.deepEqual(exited, { code: 0, signal: null, timedOut: false })
})

test('ProcessRunner settles and closes output streams when the command is unavailable', async () => {
  const runner = new NodeProcessRunner()
  const running = runner.start({ command: 'taskflow-command-that-does-not-exist', args: [] })
  const [stdout, stderr, exited] = await Promise.all([text(running.stdout), text(running.stderr), running.exited])
  assert.equal(stdout, '')
  assert.equal(stderr, '')
  assert.equal(exited.signal, null)
  assert.equal(exited.timedOut, false)
  assert.ok(exited.code === null || exited.code === -2)
})

test('ProcessRunner terminates the spawned process tree on timeout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'taskflow-process-tree-'))
  const marker = join(root, 'child-survived')
  try {
    const runner = new NodeProcessRunner()
    const childSource = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 300)`
    const running = runner.start({
      command: process.execPath,
      args: [
        '-e',
        `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childSource)}], { stdio: "ignore" }); setTimeout(() => {}, 1000);`,
      ],
      timeoutMs: 50,
      graceMs: 10,
    })
    const exited = await running.exited
    await new Promise((resolve) => setTimeout(resolve, 450))
    assert.equal(exited.timedOut, true)
    assert.equal(existsSync(marker), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
