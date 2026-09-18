// The one string every layer stores about work, and what it refuses.
//
// These refs arrive from a URL segment, a CLI argument and an agent, and they
// address somebody's real issue. A ref that parsed "close enough" would point
// at a different issue than the one somebody meant, so the refusals matter more
// than the happy path.

import { describe, expect, it } from 'vitest'
import {
  formatIssueRef,
  githubIssueRef,
  issueRefLabel,
  issueRefUrl,
  isTaskProvider,
  parseGitHubIssueRef,
  parseIssueRef,
  TASK_PROVIDERS,
} from './issues.ts'

describe('the providers work can live in', () => {
  it('is exactly two, and there is no local mode', () => {
    expect([...TASK_PROVIDERS]).toEqual(['github', 'linear'])
    expect(isTaskProvider('local')).toBe(false)
    expect(isTaskProvider('jira')).toBe(false)
  })
})

describe('reading a ref back', () => {
  it('reads a GitHub ref into what a gh call needs', () => {
    const ref = parseGitHubIssueRef('github:codions-labs/portta#113')
    expect(ref).toEqual({
      provider: 'github',
      key: 'codions-labs/portta#113',
      slug: 'codions-labs/portta',
      number: 113,
    })
  })

  it('reads a Linear ref, and normalises its case so one issue is one row', () => {
    expect(parseIssueRef('linear:eng-42')).toEqual({ provider: 'linear', key: 'ENG-42' })
    expect(parseIssueRef('linear:ENG-42')).toEqual({ provider: 'linear', key: 'ENG-42' })
  })

  it('refuses anything it cannot address', () => {
    for (const bad of [
      '',
      'portta#113', // no provider
      'local:12', // not a provider
      'github:portta#113', // no owner
      'github:codions-labs/portta', // no number
      'github:codions-labs/portta#abc',
      'linear:42', // no team key
      'linear:',
      ':113',
    ]) {
      expect(parseIssueRef(bad), bad).toBeNull()
    }
  })

  it('does not read a Linear ref as a GitHub one', () => {
    expect(parseGitHubIssueRef('linear:ENG-42')).toBeNull()
  })
})

describe('what a ref becomes', () => {
  it('round-trips through the formatter', () => {
    expect(githubIssueRef('codions-labs/portta', 113)).toBe('github:codions-labs/portta#113')
    expect(parseIssueRef(formatIssueRef('linear', 'ENG-42'))?.key).toBe('ENG-42')
  })

  it('shows a person the short form, never the provider prefix', () => {
    expect(issueRefLabel('github:codions-labs/portta#113')).toBe('portta#113')
    expect(issueRefLabel('linear:ENG-42')).toBe('ENG-42')
    // Unparseable is shown as written rather than swallowed.
    expect(issueRefLabel('whatever')).toBe('whatever')
  })

  // Linear's URL needs the workspace slug, which a ref does not carry, so it
  // links nowhere from here rather than to a wrong workspace.
  it('links a GitHub ref and refuses to invent a Linear one', () => {
    expect(issueRefUrl('github:codions-labs/portta#113')).toBe('https://github.com/codions-labs/portta/issues/113')
    expect(issueRefUrl('linear:ENG-42')).toBeNull()
  })
})
