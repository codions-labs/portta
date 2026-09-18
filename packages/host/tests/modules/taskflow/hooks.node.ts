import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NodeLifecycleHookRunner } from '../../../src/modules/taskflow/adapters/hooks.ts'
import type {
  ProcessExit,
  ProcessRunner,
  ProcessSpec,
  RunningProcess,
} from '../../../src/modules/taskflow/adapters/process-runner.ts'

interface RecordedProcess {
  spec: ProcessSpec
  exit: ProcessExit
  stdout?: string
  stderr?: string
}

class FakeProcessRunner implements ProcessRunner {
  readonly calls: ProcessSpec[] = []

  private readonly responses: RecordedProcess[]
  constructor(responses: RecordedProcess[]) {
    this.responses = responses
  }

  start(spec: ProcessSpec): RunningProcess {
    this.calls.push(spec)
    const response = this.responses.shift()
    if (!response) throw new Error('Unexpected process start')
    assert.deepEqual(spec, response.spec)
    return {
      pid: undefined,
      stdout: new Response(response.stdout ?? '').body ?? new ReadableStream<Uint8Array>(),
      stderr: new Response(response.stderr ?? '').body ?? new ReadableStream<Uint8Array>(),
      exited: Promise.resolve(response.exit),
      writeStdin: async (): Promise<void> => {},
      closeStdin: (): void => {},
      kill: (): boolean => true,
    }
  }
}

function succeeded(): ProcessExit {
  return { code: 0, signal: null, timedOut: false }
}

function failed(code: number): ProcessExit {
  return { code, signal: null, timedOut: false }
}

test('runs hooks through bash with the supplied environment when direnv is unavailable', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'taskflow-hooks-'))
  context.after(async (): Promise<void> => {
    await rm(cwd, { recursive: true, force: true })
  })
  const runner = new FakeProcessRunner([
    { spec: { command: 'direnv', args: ['version'] }, exit: failed(1) },
    {
      spec: { command: 'bash', args: ['-c', 'echo ready'], cwd, env: { PORTTA_FLOW_HOOK_VALUE: 'set' } },
      exit: succeeded(),
      stdout: 'ready\n',
    },
  ])

  await new NodeLifecycleHookRunner(runner).run({
    name: 'postCreate',
    command: 'echo ready',
    cwd,
    env: { PORTTA_FLOW_HOOK_VALUE: 'set' },
  })

  assert.equal(runner.calls.length, 2)
})

test('allows and executes .envrc hooks through direnv', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'taskflow-hooks-'))
  context.after(async (): Promise<void> => {
    await rm(cwd, { recursive: true, force: true })
  })
  await writeFile(join(cwd, '.envrc'), 'export FROM_ENVRC=1\n')
  await access(join(cwd, '.envrc'))
  const runner = new FakeProcessRunner([
    { spec: { command: 'direnv', args: ['version'] }, exit: succeeded() },
    { spec: { command: 'direnv', args: ['allow'], cwd }, exit: succeeded() },
    {
      spec: { command: 'direnv', args: ['exec', cwd, 'bash', '-c', 'echo $FROM_ENVRC'], cwd, env: {} },
      exit: succeeded(),
      stdout: '1\n',
    },
  ])

  await new NodeLifecycleHookRunner(runner).run({ name: 'preRemove', command: 'echo $FROM_ENVRC', cwd, env: {} })

  assert.equal(runner.calls.length, 3)
})

test('reports hook output when the process exits unsuccessfully', async (context) => {
  const cwd = await mkdtemp(join(tmpdir(), 'taskflow-hooks-'))
  context.after(async (): Promise<void> => {
    await rm(cwd, { recursive: true, force: true })
  })
  const runner = new FakeProcessRunner([
    { spec: { command: 'direnv', args: ['version'] }, exit: failed(1) },
    { spec: { command: 'bash', args: ['-c', 'exit 7'], cwd, env: {} }, exit: failed(7), stderr: 'hook broke\n' },
  ])

  await assert.rejects(
    new NodeLifecycleHookRunner(runner).run({ name: 'preRemove', command: 'exit 7', cwd, env: {} }),
    /preRemove hook failed \(exit 7\): hook broke/,
  )
})
