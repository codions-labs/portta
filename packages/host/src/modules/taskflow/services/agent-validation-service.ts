import type { ValidateCustomAgentResponse } from 'portta-contracts/taskflow'
import { agentTemplatePlaceholder } from 'portta-core/taskflow/config'
import { normalizeCustomAgentId } from './agent-registry.ts'

export function validateCustomAgentInput(input: {
  label: string
  startCommand: string
  resumeCommand?: string
}): ValidateCustomAgentResponse {
  const warnings: string[] = []

  const promptPlaceholder = agentTemplatePlaceholder('PROMPT')
  const systemPromptPlaceholder = agentTemplatePlaceholder('SYSTEM_PROMPT')
  if (!input.startCommand.includes(promptPlaceholder) && !input.startCommand.includes(systemPromptPlaceholder)) {
    warnings.push(
      `Start command does not reference ${promptPlaceholder} or ${systemPromptPlaceholder}; initial prompts will not be passed automatically`,
    )
  }

  if (!input.resumeCommand?.trim()) {
    warnings.push('Resume command is not configured; reopening the worktree will restart the agent')
  }

  return {
    normalizedId: normalizeCustomAgentId(input.label),
    warnings,
  }
}
