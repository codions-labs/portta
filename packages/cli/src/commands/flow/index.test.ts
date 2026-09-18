import { Command } from 'commander'
import { describe, expect, it } from 'vitest'
import { flowInvocation, setFlowInvocation } from './flow-action.ts'
import { createFlowCommand } from './index.ts'
import { parseFlow } from './test-support.ts'

const TOP_LEVEL_COMMANDS = [
  'init',
  'add',
  'oneshot',
  'doctor',
  'list',
  'open',
  'close',
  'refresh',
  'archive',
  'unarchive',
  'label',
  'profile',
  'remove',
  'merge',
  'send',
  'tab',
  'prune',
  'restore',
  'multiplexer',
  'linear',
  'project',
  'workflows',
  'run',
  'runs',
  'environment',
  'completion',
]

describe('flow command tree', () => {
  it('lists every command in the help output', async () => {
    const result = await parseFlow(['--help'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Usage: taskflow [options] [command]')
    for (const name of TOP_LEVEL_COMMANDS) expect(result.stdout).toMatch(new RegExp(`^  ${name}\\b`, 'm'))
    expect(result.stdout).toContain('environment|env')
    expect(result.stdout).not.toContain('__complete')
  })

  it('defines exactly the documented top-level commands', () => {
    const names = createFlowCommand().commands.map((command) => command.name())
    expect(names).toEqual([...TOP_LEVEL_COMMANDS, '__complete'])
  })

  it('prints help for a bare invocation and exits 0', async () => {
    const result = await parseFlow([])
    expect(result.exitCode).toBe(0)
    expect(result.action).toBeUndefined()
    expect(result.stdout).toContain('Usage: taskflow')
  })

  it('exits 1 for an unknown command', async () => {
    const result = await parseFlow(['frobnicate'])
    expect(result.exitCode).toBe(1)
    expect(result.action).toBeUndefined()
    expect(result.stderr).toContain("unknown command 'frobnicate'")
    expect(result.stderr).toContain('(run with --help for usage)')
  })

  it('exits 1 for an unknown option', async () => {
    const result = await parseFlow(['list', '--bogus'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unknown option '--bogus'")
  })

  it('prints subcommand help without running the command', async () => {
    for (const argv of [
      ['merge', '--help'],
      ['list', '--help'],
      ['prune', '--help'],
      ['send', '-h'],
      ['restore', '--help'],
    ]) {
      const result = await parseFlow(argv)
      expect(result.exitCode).toBe(0)
      expect(result.action).toBeUndefined()
      expect(result.stdout).toContain(`Usage: taskflow ${argv[0]}`)
    }
  })

  it('leaves the daemon, its service, update and version to Portta', async () => {
    for (const name of ['serve', 'service', 'update', 'version']) {
      const result = await parseFlow([name])
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`unknown command '${name}'`)
    }
    expect((await parseFlow(['--version'])).exitCode).toBe(1)
  })

  it('shows group help for bare groups and runs the default for runs and workflows', async () => {
    for (const group of ['linear', 'project', 'run']) {
      const result = await parseFlow([group])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain(`Usage: taskflow ${group}`)
    }
    expect((await parseFlow(['runs'])).action?.path).toEqual(['runs', 'list'])
    expect((await parseFlow(['workflows'])).action?.path).toEqual(['workflows', 'list'])
    expect((await parseFlow(['workflows', 'explode'])).exitCode).toBe(1)
  })

  it('rejects an unknown project subcommand', async () => {
    const result = await parseFlow(['project', 'migrate'])
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("unknown command 'migrate'")
  })

  it('hands the runner an exit code to set on the process', async () => {
    const previous = process.exitCode
    const flow = createFlowCommand({ run: async () => 7 })
    await flow.parseAsync(['prune'], { from: 'user' })
    expect(process.exitCode).toBe(7)
    process.exitCode = previous
  })

  it('reports handler validation errors as usage errors', async () => {
    const result = await parseFlow(['add', 'feature/x', '--interface', 'desktop'], {
      run: async (action) => (await import('./dispatch.ts')).runFlowAction(action),
    })
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('error: --interface must be "terminal" or "web-chat"')
  })
})

describe('flow command names', () => {
  it('derives usage from the name it is given', async () => {
    const result = await parseFlow(['add', '--help'], { name: 'flow' })
    expect(result.stdout).toContain('Usage: flow add [options] [branch]')
    expect(result.stdout).not.toContain('Usage: taskflow')
  })

  it('derives examples from the full path once mounted in another program', () => {
    const program = new Command('portta')
    program.addCommand(createFlowCommand({ name: 'flow' }))
    const flow = program.commands[0]
    const tab = flow?.commands.find((command) => command.name() === 'tab')
    let help = ''
    tab?.configureOutput({ writeOut: (text) => (help += text) }).outputHelp()
    expect(help).toContain('Usage: portta flow tab [options] <branch> [action] [tabId]')
    expect(help).toContain('portta flow tab <branch> switch <tabId>')
    expect(help).not.toMatch(/\btaskflow\b/)
  })

  it('names Linear follow-ups after the mounted command', () => {
    const program = new Command('portta')
    program.addCommand(createFlowCommand({ name: 'flow' }))
    const post = program.commands[0]?.commands
      .find((command) => command.name() === 'linear')
      ?.commands.find((command) => command.name() === 'post')
    let help = ''
    post?.configureOutput({ writeOut: (text) => (help += text) }).outputHelp()
    expect(help).toContain('`portta flow oneshot --linear')
    expect(help).toContain('`portta flow add --from-linear <issue-id>`')
  })

  it('names handler hints after the mounted command', async () => {
    const program = new Command('portta')
    let seen = ''
    program.addCommand(
      createFlowCommand({
        name: 'flow',
        run: async () => {
          seen = flowInvocation()
          return 0
        },
      }),
    )
    const previous = process.exitCode
    await program.parseAsync(['flow', 'prune'], { from: 'user' })
    process.exitCode = previous
    expect(seen).toBe('portta flow')
    setFlowInvocation('taskflow')
  })
})
