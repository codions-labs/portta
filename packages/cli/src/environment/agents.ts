import { environmentToolVerdict } from 'portta-core'
import { toolFacts } from './common.js'
import type { EnvironmentProbe } from './types.js'

const AGENTS = [
  ['agents.claude', 'Claude Code', 'claude'],
  ['agents.codex', 'Codex CLI', 'codex'],
  ['agents.cursor', 'Cursor agent', 'cursor-agent'],
  ['agents.gemini', 'Gemini CLI', 'gemini'],
  ['agents.antigravity', 'Antigravity', 'antigravity'],
] as const

export const agentsProbe: EnvironmentProbe = {
  id: 'agents',
  async probe(context) {
    return Promise.all(
      AGENTS.map(async ([id, title, command]) =>
        environmentToolVerdict(await toolFacts(context, command, ['--version']), {
          id,
          title,
          category: 'agents',
          optional: true,
          fix: `install ${title} only when you intend to use it`,
        }),
      ),
    )
  },
}
