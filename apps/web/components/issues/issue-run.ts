import { proposedIssueBranch } from 'portta-core/browser'

/** The CTA is a write: hide it when the person cannot start a Run, or Taskflow cannot. */
export function canStartIssueRun(mayWrite: boolean, available: boolean | undefined): boolean {
  return mayWrite && available === true
}

export function proposedBranchForIssue(pattern: string, title: string, type: string): string {
  return proposedIssueBranch(pattern, title, type)
}
