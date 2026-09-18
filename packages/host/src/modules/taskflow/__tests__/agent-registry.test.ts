import type { ProjectConfig } from 'portta-core/taskflow'
import { describe, expect, it } from 'vitest'
import {
  getAgentDefinition,
  isBuiltInAgentId,
  listAgentDefinitions,
  listAgentSummaries,
  normalizeCustomAgentId,
} from '../services/agent-registry.ts'

const TEST_CONFIG: ProjectConfig = {
  name: 'Project',
  multiplexer: 'tmux',
  workspace: {
    mainBranch: 'main',
    worktreeRoot: '__worktrees',
    worktrees: { root: '__worktrees' },
    defaultAgent: 'claude',
    autoPull: { enabled: false, intervalSeconds: 300 },
  },
  exposure: { local: { provider: 'loopback', autoExpose: 'all' } },
  profiles: {
    default: {
      runtime: 'host',
      envPassthrough: [],
      panes: [{ id: 'agent', kind: 'agent', focus: true }],
    },
  },
  agents: {
    gemini: {
      label: 'Gemini CLI',
      startCommand: 'gemini --prompt "${PROMPT}"',
      resumeCommand: 'gemini resume --last',
    },
  },
  services: [],
  startupEnvs: {},
  integrations: {
    github: { linkedRepos: [], autoRemoveOnMerge: false },
    linear: { enabled: true, autoCreateWorktrees: false, createTicketOption: false },
  },
  providers: {},
  lifecycleHooks: {},
  autoName: null,
  oneshot: { systemPrompt: '' },
}

describe('agent-registry', () => {
  it('lists built-in agents before local custom agents', () => {
    expect(listAgentDefinitions(TEST_CONFIG).map((agent) => agent.id)).toEqual(['claude', 'codex', 'gemini'])
  })

  it('exposes custom agents as terminal-only summaries', () => {
    expect(listAgentSummaries(TEST_CONFIG)).toEqual([
      {
        id: 'claude',
        label: 'Claude',
        kind: 'builtin',
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
      {
        id: 'codex',
        label: 'Codex',
        kind: 'builtin',
        capabilities: {
          terminal: true,
          inAppChat: true,
          conversationHistory: true,
          interrupt: true,
          resume: true,
        },
      },
      {
        id: 'gemini',
        label: 'Gemini CLI',
        kind: 'custom',
        capabilities: {
          terminal: true,
          inAppChat: false,
          conversationHistory: false,
          interrupt: false,
          resume: true,
        },
      },
    ])
  })

  it('ignores custom agents that collide with built-in ids', () => {
    const definitions = listAgentDefinitions({
      ...TEST_CONFIG,
      agents: {
        ...TEST_CONFIG.agents,
        claude: {
          label: 'Override',
          startCommand: 'custom-claude',
        },
      },
    })

    expect(definitions.map((agent) => agent.id)).toEqual(['claude', 'codex', 'gemini'])
    expect(definitions[0]?.label).toBe('Claude')
  })

  it('resolves built-in and custom agent definitions by id', () => {
    const claude = getAgentDefinition(TEST_CONFIG, 'claude')
    const gemini = getAgentDefinition(TEST_CONFIG, 'gemini')
    const missing = getAgentDefinition(TEST_CONFIG, 'missing')

    expect(claude?.kind).toBe('builtin')
    expect(gemini?.kind).toBe('custom')
    expect(gemini?.implementation.type).toBe('custom')
    expect(missing).toBeNull()
  })

  it('normalizes custom agent ids and detects built-ins', () => {
    expect(normalizeCustomAgentId('Gemini CLI')).toBe('gemini-cli')
    expect(normalizeCustomAgentId('!!!')).toBe('agent')
    expect(isBuiltInAgentId('claude')).toBe(true)
    expect(isBuiltInAgentId('gemini')).toBe(false)
  })
})
