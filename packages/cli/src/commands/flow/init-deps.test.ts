import { describe, expect, it } from 'vitest'
import {
  evaluateInitDependencies,
  INIT_DEPENDENCIES,
  inspectInitDependency,
  isInitAgentSelectable,
  missingRequiredDependencies,
} from './init-deps.ts'

const required = INIT_DEPENDENCIES.filter((dep) => dep.required)
const optionalAgents = INIT_DEPENDENCIES.filter((dep) => dep.tool === 'claude' || dep.tool === 'codex')

describe('evaluateInitDependencies', () => {
  it('treats a tool found outside PATH as present even when --version fails', () => {
    const statuses = evaluateInitDependencies(optionalAgents, {
      resolveTool: (tool: string): string | null => (tool === 'codex' ? '/home/me/.local/bin/codex' : null),
      runTool: (): boolean => false,
    })

    expect(statuses).toEqual([
      expect.objectContaining({ tool: 'claude', found: false, probeOk: false }),
      expect.objectContaining({ tool: 'codex', found: true, probeOk: false }),
    ])
    expect(isInitAgentSelectable(statuses[1]!)).toBe(true)
    expect(isInitAgentSelectable(statuses[0]!)).toBe(false)
  })

  it('requires required tools to be resolved, not just to pass a version probe', () => {
    const statuses = evaluateInitDependencies(required, {
      resolveTool: (tool: string): string | null => (tool === 'git' ? '/usr/bin/git' : null),
      runTool: (): boolean => true,
    })

    expect(missingRequiredDependencies(statuses).map((status) => status.tool)).toEqual(
      required.filter((dep) => dep.tool !== 'git').map((dep) => dep.tool),
    )
  })

  it('marks a missing Codex as not selectable', () => {
    const status = inspectInitDependency(optionalAgents.find((dep) => dep.tool === 'codex')!, {
      resolveTool: () => null,
      runTool: () => true,
    })
    expect(status.found).toBe(false)
    expect(isInitAgentSelectable(status)).toBe(false)
  })
})
