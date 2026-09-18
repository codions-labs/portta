import type { ProjectInitState } from 'portta-contracts/taskflow'
import { describe, expect, it } from 'vitest'
import { awaitProjectSetup, projectFromCli } from './project-commands.ts'
import { parseFlow, parseFlowAction } from './test-support.ts'

async function parseProject(args: string[]) {
  return projectFromCli(await parseFlowAction(['project', ...args]))
}

describe('project command parsing', () => {
  it('shows help for no args or --help', async () => {
    for (const args of [['project'], ['project', '--help'], ['project', '-h']]) {
      const result = await parseFlow(args)
      expect(result.exitCode).toBe(0)
      expect(result.action).toBeUndefined()
      expect(result.stdout).toContain('Usage: taskflow project')
    }
  })

  it('parses ls / list', async () => {
    expect(await parseProject(['ls'])).toEqual({ subcommand: 'ls' })
    expect(await parseProject(['list'])).toEqual({ subcommand: 'ls' })
  })

  it('rejects extra args to ls', async () => {
    await expect(parseProject(['ls', 'extra'])).rejects.toThrow('too many arguments')
  })

  it('parses add with a path and defaults to the current dir', async () => {
    expect(await parseProject(['add', '~/code/x'])).toEqual({ subcommand: 'add', path: '~/code/x' })
    expect(await parseProject(['add'])).toEqual({ subcommand: 'add', path: '.' })
  })

  it('rejects extra args to add', async () => {
    await expect(parseProject(['add', 'a', 'b'])).rejects.toThrow('too many arguments')
  })

  it('parses rm / remove with a prefix', async () => {
    expect(await parseProject(['rm', 'svc'])).toEqual({ subcommand: 'rm', prefix: 'svc' })
    expect(await parseProject(['remove', 'svc'])).toEqual({ subcommand: 'rm', prefix: 'svc' })
  })

  it('requires a prefix for rm', async () => {
    await expect(parseProject(['rm'])).rejects.toThrow("missing required argument 'prefix'")
  })

  it('rejects unknown subcommands', async () => {
    await expect(parseProject(['frobnicate'])).rejects.toThrow("unknown command 'frobnicate'")
    await expect(parseProject(['migrate'])).rejects.toThrow("unknown command 'migrate'")
  })
})

function initState(over: Partial<ProjectInitState>): ProjectInitState {
  return { path: '/repo/a', phase: 'creating_config', prefix: null, name: null, error: null, ...over }
}

describe('awaitProjectSetup', () => {
  it('logs each phase once and resolves with the ready state', async () => {
    const logs: string[] = []
    const frames: ProjectInitState[][] = [
      [initState({ phase: 'creating_config' })],
      [initState({ phase: 'creating_config' })], // unchanged → not logged again
      [initState({ phase: 'analyzing' })],
      [initState({ phase: 'ready', prefix: 'a', name: 'A' })],
    ]
    let i = 0

    const ready = await awaitProjectSetup('/repo/a', {
      poll: async () => frames[Math.min(i++, frames.length - 1)]!,
      sleep: async () => {},
      log: (m) => logs.push(m),
    })

    expect(ready).toMatchObject({ phase: 'ready', prefix: 'a', name: 'A' })
    expect(logs).toEqual(['  Creating .portta/taskflow.yaml…', '  Analyzing project structure…'])
  })

  it('throws with the server error when setup fails', async () => {
    await expect(
      awaitProjectSetup('/repo/a', {
        poll: async () => [initState({ phase: 'failed', error: 'no git' })],
        sleep: async () => {},
        log: () => {},
      }),
    ).rejects.toThrow('no git')
  })

  it('throws on timeout when the job never appears', async () => {
    let clock = 0
    await expect(
      awaitProjectSetup('/repo/a', {
        poll: async () => [],
        sleep: async () => {
          clock += 1000
        },
        now: () => clock,
        timeoutMs: 1500,
        log: () => {},
      }),
    ).rejects.toThrow('timed out')
  })
})
