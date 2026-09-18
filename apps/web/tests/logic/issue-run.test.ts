import { describe, expect, it } from 'vitest'
import { canStartIssueRun, proposedBranchForIssue } from '@/components/issues/issue-run.ts'

describe('the issue Run gesture', () => {
  it('proposes a branch from the project pattern and the issue title', () => {
    expect(proposedBranchForIssue('{type}/{slug}', 'Da issue à Run', 'fix')).toBe('fix/da-issue-a-run')
    expect(proposedBranchForIssue('{slug}/{type}', 'Named URLs', 'feat')).toBe('named-urls/feat')
  })

  it('is offered only when the person may write and Taskflow can start a Run', () => {
    expect(canStartIssueRun(true, true)).toBe(true)
    expect(canStartIssueRun(true, false)).toBe(false)
    expect(canStartIssueRun(true, undefined)).toBe(false)
    expect(canStartIssueRun(false, true)).toBe(false)
  })
})
