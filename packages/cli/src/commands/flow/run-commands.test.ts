import { describe, expect, it } from 'vitest'
import { runCommandFromCli } from './run-commands.ts'
import { parseFlowAction } from './test-support.ts'

async function parseRun(args: string[]) {
  return runCommandFromCli(await parseFlowAction(args))
}

describe('run command parsing', () => {
  it('parses workflow list and workflow Run creation input', async () => {
    expect(await parseRun(['workflows', 'list'])).toEqual({ command: 'workflows', action: 'list' })
    expect(await parseRun(['run', 'workflow', 'review', '--input-json', '{"issue":"TASK-014"}'])).toEqual({
      command: 'runs',
      action: 'create',
      mode: 'workflow',
      workflowId: 'review',
      input: { issue: 'TASK-014' },
    })
    expect(await parseRun(['run', 'direct', '--harness', 'codex', '--input', 'Fix it'])).toEqual({
      command: 'runs',
      action: 'create',
      mode: 'direct',
      harness: 'codex',
      input: 'Fix it',
    })
    expect(
      await parseRun([
        'run',
        'workflow',
        'review',
        '--workspace',
        'branch',
        '--branch',
        'fix/review',
        '--base',
        'main',
      ]),
    ).toEqual({
      command: 'runs',
      action: 'create',
      mode: 'workflow',
      workflowId: 'review',
      input: '',
      workspace: { strategy: 'new_branch', branch: 'fix/review', baseBranch: 'main' },
    })
  })

  it('rejects malformed input and unsupported Run actions', async () => {
    await expect(parseRun(['run', 'workflow', 'review', '--input-json', 'nope'])).rejects.toThrow(
      '--input-json must be a JSON object',
    )
    await expect(parseRun(['run', 'direct'])).rejects.toThrow("required option '--harness <agent>' not specified")
    await expect(parseRun(['runs', 'pause', 'run_01'])).rejects.toThrow("unknown command 'pause'")
    await expect(parseRun(['run', 'workflow', 'review', '--workspace', 'current', '--branch', 'nope'])).rejects.toThrow(
      '--branch and --base do not apply to --workspace current',
    )
    await expect(parseRun(['run', 'workflow', 'review', '--input', 'a', '--input-json', '{}'])).rejects.toThrow(
      "option '--input <text>' cannot be used with option '--input-json <json>'",
    )
  })

  it('parses ACP transport and permission mode', async () => {
    expect(
      await parseRun([
        'run',
        'direct',
        '--harness',
        'opencode',
        '--transport',
        'acp',
        '--permission-mode',
        'workspace',
        '--input',
        'Inspect',
      ]),
    ).toMatchObject({
      mode: 'direct',
      harness: 'opencode',
      transport: 'acp',
      permissionMode: 'workspace',
    })
    await expect(
      parseRun(['run', 'workflow', 'review', '--transport', 'acp', '--permission-mode', 'interactive']),
    ).rejects.toThrow('only available for Direct Runs')
  })

  it('lists Runs when runs is bare and shows one by id', async () => {
    expect(await parseRun(['runs'])).toEqual({ command: 'runs', action: 'list' })
    expect(await parseRun(['runs', 'show', 'run_01'])).toEqual({ command: 'runs', action: 'show', runId: 'run_01' })
    expect(await parseRun(['workflows'])).toEqual({ command: 'workflows', action: 'list' })
  })

  it('parses structured transcript inspection', async () => {
    expect(await parseRun(['runs', 'transcript', 'execution_01'])).toEqual({
      command: 'runs',
      action: 'transcript',
      executionId: 'execution_01',
    })
    await expect(parseRun(['runs', 'transcript'])).rejects.toThrow("missing required argument 'execution-id'")
  })

  it('parses interactive ACP permission responses', async () => {
    expect(
      await parseRun(['runs', 'permission', 'run_01', '01234567-89ab-4def-8123-456789abcdef', 'allow-once']),
    ).toEqual({
      command: 'runs',
      action: 'permission',
      runId: 'run_01',
      requestId: '01234567-89ab-4def-8123-456789abcdef',
      optionId: 'allow-once',
    })
    expect(
      await parseRun(['runs', 'permission', 'run_01', '01234567-89ab-4def-8123-456789abcdef', 'deny']),
    ).toMatchObject({ action: 'permission', optionId: null })
  })
})
