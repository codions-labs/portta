import { spawnSync } from 'node:child_process'
import { Command } from 'commander'
import { describe, expect, it, vi } from 'vitest'
import { extractBranches, handleCompletions, listWorktreeBranches, runCompletionCommand } from './completions.ts'
import { createFlowCommand } from './index.ts'

describe('extractBranches', () => {
  const porcelain = [
    'worktree /repo',
    'HEAD abc123',
    'branch refs/heads/main',
    '',
    'worktree /repo/.worktrees/fix-bug',
    'HEAD def456',
    'branch refs/heads/fix-bug',
    '',
    'worktree /repo/.worktrees/feature-auth',
    'HEAD 789abc',
    'branch refs/heads/feature-auth',
    '',
  ].join('\n')

  it('returns non-main, non-bare branches', () => {
    expect(extractBranches(porcelain, '/repo')).toEqual(['fix-bug', 'feature-auth'])
  })

  it('returns all branches when mainWorktreePath is null', () => {
    expect(extractBranches(porcelain, null)).toEqual(['main', 'fix-bug', 'feature-auth'])
  })

  it('falls back to basename when branch is missing', () => {
    const detached = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/orphan-wt',
      'HEAD def456',
      'detached',
      '',
    ].join('\n')

    expect(extractBranches(detached, '/repo')).toEqual(['orphan-wt'])
  })
})

describe('listWorktreeBranches', () => {
  it('returns branches using injected git', async () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo/.worktrees/fix-bug',
      'HEAD def456',
      'branch refs/heads/fix-bug',
      '',
    ].join('\n')

    const branches = await listWorktreeBranches({
      runGit: (args: string[]) => {
        if (args[0] === 'worktree') {
          return { exitCode: 0, stdout: porcelain }
        }
        if (args[0] === 'rev-parse') {
          return { exitCode: 0, stdout: '/repo/.git' }
        }
        return { exitCode: 1, stdout: '' }
      },
    })

    expect(branches).toEqual(['fix-bug'])
  })

  it('returns empty array when git fails', async () => {
    const branches = await listWorktreeBranches({
      runGit: () => ({ exitCode: 1, stdout: '' }),
    })

    expect(branches).toEqual([])
  })
})

describe('handleCompletions', () => {
  it('outputs nothing for unknown completion kinds', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await handleCompletions('add')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('prints worktree branches', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await handleCompletions('branches', {
      runGit: (args) =>
        args[0] === 'worktree'
          ? { exitCode: 0, stdout: 'worktree /repo/.worktrees/fix\nHEAD abc\nbranch refs/heads/fix\n' }
          : { exitCode: 1, stdout: '' },
    })
    expect(spy).toHaveBeenCalledWith('fix')
    spy.mockRestore()
  })
})

function script(shell: 'bash' | 'zsh', name = 'taskflow'): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  const code = runCompletionCommand(shell, createFlowCommand({ name }))
  const output = String(spy.mock.calls[0]?.[0])
  spy.mockRestore()
  expect(code).toBe(0)
  return output
}

/** Ask the generated bash function what it offers (sorted) for `words`, the last being the word under the cursor. */
function bashComplete(words: string[]): string[] {
  const source = [
    script('bash'),
    // Stands in for `taskflow __complete branches`.
    'taskflow() { printf "feature-a\\nfeature-b\\n"; }',
    `COMP_WORDS=(${words.map((word) => `'${word}'`).join(' ')})`,
    `COMP_CWORD=${words.length - 1}`,
    '_taskflow',
    'printf "%s\\n" "${COMPREPLY[@]}"',
  ].join('\n')
  const result = spawnSync('bash', ['-c', source], { encoding: 'utf8' })
  return result.stdout.split('\n').filter(Boolean).sort()
}

const hasShell = (shell: string) => spawnSync(shell, ['-c', 'true']).status === 0

describe('runCompletionCommand', () => {
  it('prints usage without a shell', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const code = runCompletionCommand(undefined, createFlowCommand({ name: 'taskflow' }))
    expect(code).toBe(0)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Usage:'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('eval "$(taskflow completion zsh)"'))
    spy.mockRestore()
  })

  it('rejects unknown shells', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const code = runCompletionCommand('fish', createFlowCommand({ name: 'taskflow' }))
    expect(code).toBe(1)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown shell'))
    spy.mockRestore()
  })

  it('outputs a zsh completion script generated from the command tree', () => {
    const output = script('zsh')
    expect(output).toContain('#compdef taskflow')
    expect(output).toContain('compdef _taskflow taskflow')
    expect(output).toContain("'archive:Hide a worktree from the default list'")
    expect(output).toContain("'refresh:Refresh a Codex agent terminal from saved chat'")
    expect(output).toContain("'doctor:Check project, agent, and integration readiness'")
    expect(output).toContain("'label:Set or clear a workspace label'")
    expect(output).toContain("'prune:Remove all closed (not open) worktrees in the current project'")
    expect(output).toContain("'runs:Create, inspect, cancel, or resume Runs'")
    expect(output).toContain("'rm:Remove a project by its prefix'")
    expect(output).toContain('taskflow __complete branches')
    expect(output).not.toContain('migrate')
    expect(output).not.toContain('__complete:')
    expect(output).not.toContain('_taskflow "$@"')
  })

  it.skipIf(!hasShell('zsh'))('generates valid zsh syntax', () => {
    expect(spawnSync('zsh', ['-n'], { input: script('zsh'), encoding: 'utf8' }).status).toBe(0)
  })

  it('outputs a bash completion script', () => {
    const output = script('bash')
    expect(output).toContain('complete -F _taskflow taskflow')
    expect(output).toContain('prune')
    expect(spawnSync('bash', ['-n'], { input: output, encoding: 'utf8' }).status).toBe(0)
  })

  it('completes commands, subcommands, branches, and argument choices in bash', () => {
    expect(bashComplete(['taskflow', 'pr'])).toEqual(['profile', 'project', 'prune'])
    expect(bashComplete(['taskflow', 'project', ''])).toEqual(['add', 'ls', 'rm'])
    expect(bashComplete(['taskflow', 'workflows', 'va'])).toEqual(['validate'])
    expect(bashComplete(['taskflow', 'runs', 's'])).toEqual(['show'])
    expect(bashComplete(['taskflow', 'open', ''])).toEqual(['feature-a', 'feature-b'])
    expect(bashComplete(['taskflow', 'linear', 'post', 'feature-'])).toEqual(['feature-a', 'feature-b'])
    expect(bashComplete(['taskflow', 'completion', ''])).toEqual(['bash', 'zsh'])
    expect(bashComplete(['taskflow', 'tab', 'feature-a', ''])).toEqual(['close', 'list', 'new', 'switch'])
    expect(bashComplete(['taskflow', 'multiplexer', ''])).toEqual(['herdr', 'tmux'])
  })

  it('derives names and positions from where the tree is mounted', () => {
    const program = new Command('portta')
    const flow = createFlowCommand({ name: 'flow' })
    program.addCommand(flow)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    runCompletionCommand('zsh', flow)
    const output = String(spy.mock.calls[0]?.[0])
    spy.mockRestore()
    expect(output).toContain('compdef _portta_flow portta')
    expect(output).toContain('portta flow __complete branches')
    expect(output).toContain('local offset=$(( CURRENT - 3 ))')
  })
})
