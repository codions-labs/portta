import { describe, expect, it } from 'vitest'
import { projectWorktreesForIssue } from '../src/services/issues/taskflow-work.ts'

describe('projectWorktreesForIssue', () => {
  it('pairs a worktree and a Run that share the issue ref, including a PR the snapshot already has', () => {
    expect(
      projectWorktreesForIssue(
        'github:acme/api#113',
        [
          {
            path: '/repo/.portta/worktrees/fix-proxy',
            branch: 'fix/proxy-timeout',
            issueRef: 'github:acme/api#113',
            prs: [{ url: 'https://github.com/acme/api/pull/77', state: 'open' }],
          },
          {
            path: '/repo/.portta/worktrees/other',
            branch: 'feat/other',
            issueRef: 'github:acme/api#999',
          },
        ],
        [
          {
            id: 'run_01',
            status: 'running',
            issueRef: 'github:acme/api#113',
            workspace: { branch: 'fix/proxy-timeout' },
          },
        ],
      ),
    ).toEqual([
      {
        branch: 'fix/proxy-timeout',
        path: '/repo/.portta/worktrees/fix-proxy',
        runId: 'run_01',
        runStatus: 'running',
        pullRequestUrl: 'https://github.com/acme/api/pull/77',
        pullRequestState: 'open',
      },
    ])
  })

  it('answers nothing for an issue no worktree or Run is linked to', () => {
    expect(
      projectWorktreesForIssue(
        'github:acme/api#113',
        [{ path: '/repo/.portta/worktrees/other', branch: 'feat/other', issueRef: 'github:acme/api#999' }],
        [{ id: 'run_01', status: 'running', issueRef: 'linear:ENG-42' }],
      ),
    ).toEqual([])
  })
})
