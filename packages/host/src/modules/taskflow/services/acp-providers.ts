// The ACP provider registry: which provider ids a Run may name, and the adapter command each one
// launches. The Agent Client Protocol is an open protocol — any harness that speaks it can drive a
// Portta Run — so the list of who speaks it must be open too. Four providers ship as builtins; a
// Project adds more, or replaces a builtin's command, under `providers:` in `.portta/taskflow.yaml`
// (then the `.portta/taskflow.local.yaml` overlay). Precedence is builtin < project < local, and a
// declared id replaces the whole entry. Resolution happens once per project config load; the
// native worker factories never consult this registry (they only run the builtins in-process).

import type { AcpProviderConfig } from 'portta-core/taskflow'
import { BUILTIN_PROVIDER_IDS, type BuiltinProviderId } from '../workflows/dsl/types.ts'

export const BUILTIN_ACP_PROVIDERS: Record<BuiltinProviderId, AcpProviderConfig> = {
  codex: { label: 'Codex', command: 'codex-acp', args: [] },
  'claude-code': { label: 'Claude Code', command: 'claude-agent-acp', args: [] },
  opencode: { label: 'OpenCode', command: 'opencode', args: ['acp'] },
  pi: { label: 'Pi', command: 'pi-acp', args: [] },
}

export interface ResolvedAcpProvider {
  id: string
  label: string
  command: string
  args: string[]
  /** False for an id the Project declared, including a builtin it replaced. */
  builtin: boolean
}

export type AcpProviderRegistry = ReadonlyMap<string, ResolvedAcpProvider>

/** Builtins first, then the declared entries; a declared id replaces the builtin of the same name. */
export function resolveAcpProviders(declared: Record<string, AcpProviderConfig>): AcpProviderRegistry {
  const registry = new Map<string, ResolvedAcpProvider>()
  for (const id of BUILTIN_PROVIDER_IDS) {
    const provider = BUILTIN_ACP_PROVIDERS[id]
    registry.set(id, { id, label: provider.label, command: provider.command, args: [...provider.args], builtin: true })
  }
  for (const [id, provider] of Object.entries(declared)) {
    registry.set(id, { id, label: provider.label, command: provider.command, args: [...provider.args], builtin: false })
  }
  return registry
}

/** The ids a registry knows, for error messages and validation lists. */
export function availableProviders(registry: AcpProviderRegistry): string {
  return Array.from(registry.keys()).join(', ')
}
