import { describe, expect, it } from 'vitest'
import { oneshotConversationTransport, oneshotFromCli } from './oneshot.ts'
import { parseFlowAction } from './test-support.ts'

async function parseOneshot(args: string[]) {
  const action = await parseFlowAction(['oneshot', ...args])
  return oneshotFromCli(action.args[0] as string | undefined, action.options)
}

describe('oneshotConversationTransport', () => {
  it('polls Codex history without opening a competing app-server writer', async () => {
    expect(oneshotConversationTransport('codex')).toBe('history')
  })

  it('retains streaming with history fallback for other agents', async () => {
    expect(oneshotConversationTransport('claude')).toBe('stream-and-history')
  })
})

describe('oneshot parsing', () => {
  it('requires --prompt for new oneshots', async () => {
    await expect(parseOneshot(['feature/search'])).rejects.toThrow('oneshot requires --prompt')
  })

  it('parses positional branch and prompt', async () => {
    const parsed = await parseOneshot(['feature/search', '--prompt', 'Fix bug'])
    expect(parsed?.body.branch).toBe('feature/search')
    expect(parsed?.body.prompt).toBe('Fix bug')
    expect(parsed?.resume).toBe(false)
  })

  it('parses --keep-open', async () => {
    const parsed = await parseOneshot(['feature/search', '--prompt', 'Fix bug', '--keep-open'])
    expect(parsed?.keepOpen).toBe(true)
  })

  it('rejects --resume without --prompt', async () => {
    await expect(parseOneshot(['--resume', 'feature/search'])).rejects.toThrow('--resume requires --prompt')
  })

  it('parses --resume with follow-up prompt', async () => {
    const parsed = await parseOneshot(['--resume', 'feature/search', '--prompt', "you're stuck, continue"])
    expect(parsed?.resume).toBe(true)
    expect(parsed?.prompt).toBe("you're stuck, continue")
  })

  it('rejects --resume without a branch', async () => {
    await expect(parseOneshot(['--resume='])).rejects.toThrow('--resume requires a branch name')
  })

  it('rejects positional branch combined with --resume of a different branch', async () => {
    await expect(parseOneshot(['other', '--resume', 'feature/search', '--prompt', 'x'])).rejects.toThrow(
      'Cannot pass both a positional branch and --resume',
    )
  })

  it('parses agent, base, profile, env overrides', async () => {
    const parsed = await parseOneshot([
      'feature/search',
      '--prompt',
      'Fix bug',
      '--agent',
      'codex',
      '--base',
      'main',
      '--profile',
      'sandbox',
      '--env',
      'FOO=bar',
      '--env=BAZ=qux',
    ])
    expect(parsed?.body.agent).toBe('codex')
    expect(parsed?.body.baseBranch).toBe('main')
    expect(parsed?.body.profile).toBe('sandbox')
    expect(parsed?.body.envOverrides).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('--linear with an issue id sets both seed and post target (round-trip)', async () => {
    const parsed = await parseOneshot(['--linear', 'ENG-42'])
    expect(parsed?.fromLinearIssueId).toBe('ENG-42')
    expect(parsed?.postToLinearTarget).toEqual({ kind: 'issue', issueId: 'ENG-42' })
    expect(parsed?.resume).toBe(false)
  })

  it('--linear with a team key sets only the post target', async () => {
    const parsed = await parseOneshot(['feature/search', '--prompt', 'Fix', '--linear', 'ENG'])
    expect(parsed?.fromLinearIssueId).toBeNull()
    expect(parsed?.postToLinearTarget).toEqual({ kind: 'team', teamKey: 'ENG' })
  })

  it('rejects invalid --linear values', async () => {
    await expect(parseOneshot(['feature/search', '--prompt', 'Fix', '--linear', 'eng-1'])).rejects.toThrow(
      '--linear expects either an issue id',
    )
    await expect(parseOneshot(['feature/search', '--prompt', 'Fix', '--linear', ''])).rejects.toThrow(
      '--linear expects either an issue id',
    )
  })

  it('rejects --linear combined with --resume', async () => {
    await expect(parseOneshot(['--resume', 'feat/foo', '--linear', 'ENG-12'])).rejects.toThrow(
      'Cannot use --resume with --linear <issue-id>',
    )
  })

  it('accepts --branch as override alongside --linear (issue id)', async () => {
    const parsed = await parseOneshot(['--linear', 'ENG-12', '--branch', 'feat/override'])
    expect(parsed?.branch).toBe('feat/override')
    expect(parsed?.fromLinearIssueId).toBe('ENG-12')
  })

  it('rejects --branch with conflicting positional branch', async () => {
    await expect(parseOneshot(['feat/positional', '--prompt', 'Fix', '--branch', 'feat/override'])).rejects.toThrow(
      'Conflicting branch values',
    )
  })

  it('rejects --branch without --linear', async () => {
    await expect(parseOneshot(['--prompt', 'Fix', '--branch', 'feat/override'])).rejects.toThrow(
      '--branch only applies with --linear',
    )
  })

  it('rejects --branch with --resume with a precise message', async () => {
    await expect(parseOneshot(['--resume', 'feat/foo', '--branch', 'feat/bar'])).rejects.toThrow(
      'Cannot use --branch with --resume',
    )
  })
})
