// The `gh` command line each operation builds.
//
// These assert argv, not GitHub. What they are for is the class of bug that
// only appears against the real thing: `gh` refuses `issue edit` with no field
// flag, spells a state change as two verbs rather than a field, and accepts
// `--reason` on one of them and not the other. Every one of those was found by
// running it, and every one of them is a wrong argv this file now pins.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const runs: string[][] = []

vi.mock('../src/forge/gh.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/forge/gh.ts')>('../src/forge/gh.ts')
  return {
    ...actual,
    runGh: async (args: readonly string[]) => {
      runs.push([...args])
      return 'https://github.com/acme/api/issues/7\n'
    },
    runGhJson: async (args: readonly string[]) => {
      runs.push([...args])
      return args.includes('issue') && args.includes('view') ? { number: 7, state: 'OPEN' } : []
    },
  }
})

const { createIssue, editIssue, listIssues, setIssueState, commentOnIssue } = await import('../src/forge/issues.ts')

beforeEach(() => {
  runs.length = 0
})

/** The `gh issue edit …` invocation, ignoring the reads around it. */
const edits = () => runs.filter((args) => args[0] === 'issue' && args[1] === 'edit')

describe('editing an issue', () => {
  // The bug this file exists for: a patch that only moves the state arrives
  // here with nothing to edit, and `gh issue edit` with no field flag answers
  // "field to edit flag required when not running interactively".
  it('runs nothing at all when there is no field to change', async () => {
    await editIssue('acme/api', 7, {})
    await editIssue('acme/api', 7, { addLabels: [], removeAssignees: [] })
    expect(edits()).toEqual([])
  })

  it('names every field it was given, and only those', async () => {
    await editIssue('acme/api', 7, {
      title: 'new',
      addLabels: ['bug', 'api'],
      removeLabels: ['wontfix'],
      addAssignees: ['ada'],
    })
    expect(edits()[0]).toEqual([
      'issue',
      'edit',
      '7',
      '--repo',
      'acme/api',
      '--title',
      'new',
      '--add-label',
      'bug',
      '--add-label',
      'api',
      '--remove-label',
      'wontfix',
      '--add-assignee',
      'ada',
    ])
  })

  // An empty string is how `gh` spells "no milestone", so it is a change and
  // `undefined` is not — dropping the distinction would make clearing one
  // impossible.
  it('treats an empty milestone as clearing it, and an absent one as no change', async () => {
    await editIssue('acme/api', 7, { milestone: '' })
    expect(edits()[0]).toContain('--milestone')
    runs.length = 0
    await editIssue('acme/api', 7, { title: 'only the title' })
    expect(edits()[0]).not.toContain('--milestone')
  })
})

describe('moving an issue between states', () => {
  it('uses the verb, not a field, and only puts a reason on a close', async () => {
    await setIssueState('acme/api', 7, 'closed', 'not planned')
    expect(runs[0]).toEqual(['issue', 'close', '7', '--repo', 'acme/api', '--reason', 'not planned'])

    runs.length = 0
    await setIssueState('acme/api', 7, 'open')
    expect(runs[0]).toEqual(['issue', 'reopen', '7', '--repo', 'acme/api'])

    // `--reason` exists on `close` and not on `reopen`.
    runs.length = 0
    await setIssueState('acme/api', 7, 'open', 'completed')
    expect(runs[0]).not.toContain('--reason')
  })
})

describe('the other operations', () => {
  // The daemon never lets a working directory decide which repository a write
  // lands in: `gh issue …` is told with `--repo`, and `gh api` carries it in
  // the path. Either is explicit; neither is inferred.
  it('always names the repository, so a working directory cannot decide it', async () => {
    await listIssues('acme/api')
    await createIssue('acme/api', { title: 'x' })
    await commentOnIssue('acme/api', 7, 'hello')
    for (const args of runs) {
      const flagged = args.indexOf('--repo') >= 0 && args[args.indexOf('--repo') + 1] === 'acme/api'
      const inPath = args[0] === 'api' && (args[1] ?? '').startsWith('repos/acme/api/')
      expect(flagged || inPath, args.join(' ')).toBe(true)
    }
  })

  // A comment is arbitrary Markdown: it can exceed a command line, and an
  // argument would put it in the host's process listing.
  it('passes a comment body on stdin rather than as an argument', async () => {
    await commentOnIssue('acme/api', 7, 'a body')
    const comment = runs.find((args) => args[1] === 'comment')!
    expect(comment).toContain('--body-file')
    expect(comment).not.toContain('a body')
  })

  it('defaults a listing to open, because `gh` does and the panel should not have to say so', async () => {
    await listIssues('acme/api')
    expect(runs[0]?.[runs[0].indexOf('--state') + 1]).toBe('open')
  })
})
