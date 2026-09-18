import { describe, expect, it } from 'vitest'
import { availableProviders, resolveAcpProviders } from '../services/acp-providers.ts'
import { AcpWorkerFactory } from '../services/acp-worker-factory.ts'
import type { AgentSupervisorPort } from '../services/agent-supervisor.ts'
import { BUILTIN_PROVIDER_IDS } from '../workflows/dsl/types.ts'
import { checkProvider, WorkflowError } from '../workflows/runtime/primitives.ts'
import { AgentError } from '../workflows/worker/index.ts'

const BUILTINS = ['codex', 'claude-code', 'opencode', 'pi']

// get() must never touch the supervisor: a stub whose every method throws proves it.
function refusingSupervisor(): AgentSupervisorPort {
  const refuse = (): never => {
    throw new Error('supervisor must not be called before an agent runs')
  }
  return {
    start: refuse,
    inspect: refuse,
    events: refuse,
    cancel: refuse,
    respondPermission: refuse,
    list: refuse,
    hasActiveOperations: refuse,
  }
}

describe('resolveAcpProviders', () => {
  it('resolves the four builtins when nothing is declared', () => {
    const registry = resolveAcpProviders({})
    expect(Array.from(registry.keys())).toEqual(BUILTINS)
    expect(registry.get('opencode')).toEqual({
      id: 'opencode',
      label: 'OpenCode',
      command: 'opencode',
      args: ['acp'],
      builtin: true,
    })
    expect(availableProviders(registry)).toBe('codex, claude-code, opencode, pi')
  })

  it('adds a declared provider after the builtins', () => {
    const registry = resolveAcpProviders({ gemini: { label: 'Gemini CLI', command: 'gemini-acp', args: [] } })
    expect(Array.from(registry.keys())).toEqual([...BUILTINS, 'gemini'])
    expect(registry.get('gemini')).toEqual({
      id: 'gemini',
      label: 'Gemini CLI',
      command: 'gemini-acp',
      args: [],
      builtin: false,
    })
  })

  it('lets a declaration replace a builtin command and marks it as not builtin', () => {
    const registry = resolveAcpProviders({ codex: { label: 'Codex', command: '/opt/codex-acp', args: ['--beta'] } })
    expect(Array.from(registry.keys())).toEqual(BUILTINS)
    expect(registry.get('codex')).toEqual({
      id: 'codex',
      label: 'Codex',
      command: '/opt/codex-acp',
      args: ['--beta'],
      builtin: false,
    })
  })
})

describe('AcpWorkerFactory.get', () => {
  it('refuses an id outside the registry with unknown_provider naming the available ids', () => {
    const factory = new AcpWorkerFactory(refusingSupervisor(), resolveAcpProviders({}), 'run_01', 'deny', [], () => {
      throw new Error('unreachable')
    })
    let caught: unknown
    try {
      factory.get('gemini')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AgentError)
    expect((caught as AgentError).code).toBe('unknown_provider')
    expect((caught as AgentError).message).toContain('unknown provider "gemini"')
    expect((caught as AgentError).message).toContain('available: codex, claude-code, opencode, pi')
  })

  it('serves a declared id', () => {
    const factory = new AcpWorkerFactory(
      refusingSupervisor(),
      resolveAcpProviders({ gemini: { label: 'Gemini', command: 'gemini-acp', args: [] } }),
      'run_01',
      'deny',
      [],
      () => {
        throw new Error('unreachable')
      },
    )
    expect(factory.get('gemini').id).toBe('gemini')
  })
})

describe('checkProvider', () => {
  it('accepts a known id and undefined, and rejects the rest naming the known list', () => {
    expect(() => checkProvider(undefined, BUILTIN_PROVIDER_IDS)).not.toThrow()
    expect(() => checkProvider('pi', BUILTIN_PROVIDER_IDS)).not.toThrow()
    expect(() => checkProvider('gemini', [...BUILTIN_PROVIDER_IDS, 'gemini'])).not.toThrow()
    expect(() => checkProvider('gemini', BUILTIN_PROVIDER_IDS)).toThrow(WorkflowError)
    expect(() => checkProvider('gemini', BUILTIN_PROVIDER_IDS)).toThrow(
      'invalid provider "gemini" — must be one of codex, claude-code, opencode, pi',
    )
  })
})
