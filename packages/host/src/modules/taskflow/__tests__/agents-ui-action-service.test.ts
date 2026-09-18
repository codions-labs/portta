import { describe, expect, it } from 'vitest'
import { classifyAgentsTerminalWorktreeError } from '../services/agents-ui-action-service.ts'

describe('classifyAgentsTerminalWorktreeError', () => {
  it('maps a missing tmux window to a 409 response', () => {
    expect(
      classifyAgentsTerminalWorktreeError(new Error('No open tmux window found for worktree: feature/search')),
    ).toEqual({
      status: 409,
      error: 'No open tmux window found for worktree: feature/search',
    })
  })

  it('maps a missing worktree to a 404 response', () => {
    expect(classifyAgentsTerminalWorktreeError(new Error('Worktree not found: feature/search'))).toEqual({
      status: 404,
      error: 'Worktree not found: feature/search',
    })
  })

  it('ignores unrelated errors', () => {
    expect(classifyAgentsTerminalWorktreeError(new Error('send-keys C-c failed: target not found'))).toBeNull()
  })
})
