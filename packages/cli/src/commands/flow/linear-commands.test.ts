import { describe, expect, it } from 'vitest'
import { linearPostFromCli, parseLinearTargetArg } from './linear-commands.ts'
import { parseFlowAction } from './test-support.ts'

describe('parseLinearTargetArg', () => {
  it('recognises team keys', () => {
    expect(parseLinearTargetArg('ENG')).toEqual({ kind: 'team', teamKey: 'ENG' })
  })

  it('rejects issue ids with a helpful pointer to --linear', () => {
    expect(() => parseLinearTargetArg('ENG-42')).toThrow('--linear ENG-42')
  })

  it('throws on invalid input', () => {
    expect(() => parseLinearTargetArg('eng-1')).toThrow('Invalid Linear team key')
    expect(() => parseLinearTargetArg('')).toThrow('Invalid Linear team key')
  })
})

async function parseLinear(args: string[]) {
  const action = await parseFlowAction(['linear', ...args])
  return linearPostFromCli(String(action.args[0]), String(action.args[1]), action.options)
}

describe('linear post parsing', () => {
  it('rejects post with an issue id (use --linear instead)', async () => {
    await expect(parseLinear(['post', 'feat/foo', 'ENG-42'])).rejects.toThrow('--linear ENG-42')
  })

  it('parses post with team key', async () => {
    const parsed = await parseLinear(['post', 'feat/foo', 'ENG'])
    expect(parsed.branch).toBe('feat/foo')
    expect(parsed.target).toEqual({ kind: 'team', teamKey: 'ENG' })
  })

  it('parses post with team key and --title', async () => {
    const parsed = await parseLinear(['post', 'feat/foo', 'ENG', '--title', 'Investigate flaky test'])
    expect(parsed.target).toEqual({
      kind: 'team',
      teamKey: 'ENG',
      title: 'Investigate flaky test',
    })
  })

  it('rejects unknown subcommand', async () => {
    await expect(parseLinear(['pull', 'ENG-1'])).rejects.toThrow("unknown command 'pull'")
  })

  it('requires branch + team key', async () => {
    await expect(parseLinear(['post'])).rejects.toThrow("missing required argument 'branch'")
    await expect(parseLinear(['post', 'feat/foo'])).rejects.toThrow("missing required argument 'team-key'")
  })
})
