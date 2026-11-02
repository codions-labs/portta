import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  agentsNeedingLayer,
  agentsStatus,
  BEGIN_MARKER,
  installAgents,
  locateAssets,
  resolveLayout,
  SKILL_NAMES,
  uninstallAgents,
} from './agents.js'

const directories: string[] = []
function temp(): string {
  const directory = mkdtempSync(join(tmpdir(), 'portta-agents-'))
  directories.push(directory)
  return directory
}
function put(path: string, text: string): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}
/** Every file and symlink under a directory, with its content, for before and after comparisons. */
function snapshot(root: string): Record<string, string> {
  const found: Record<string, string> = {}
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else found[relative(root, full)] = lstatSync(full).isSymbolicLink() ? '(link)' : readFileSync(full, 'utf8')
    }
  }
  if (existsSync(root)) walk(root)
  return found
}

let home: string
let cli: { node: string; script: string }
const savedEnvironment = { ...process.env }

beforeEach(() => {
  // A test must never reach the real configuration through an inherited variable.
  delete process.env.CLAUDE_CONFIG_DIR
  delete process.env.CODEX_HOME
  home = temp()
  const script = put(join(temp(), 'cli.js'), "console.log('Portta host 0.2.0. context for the test')\n")
  cli = { node: process.execPath, script }
})
afterEach(() => {
  process.env = { ...savedEnvironment }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function allAgents() {
  for (const path of ['.claude', '.codex', '.config/opencode', '.pi/agent'])
    mkdirSync(join(home, path), { recursive: true })
}
const install = (options: Parameters<typeof installAgents>[0] = {}) => installAgents({ home, cli, env: {}, ...options })
const uninstall = (options: Parameters<typeof uninstallAgents>[0] = {}) =>
  uninstallAgents({ home, cli, env: {}, ...options })

const THIRD_PARTY = {
  theme: 'dark',
  hooks: {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: '/opt/herdr/hook session-start' }] }],
    Stop: [{ hooks: [{ type: 'command', command: '/opt/orca/hook stop' }] }],
  },
}

describe('portta agents install', () => {
  it('installs from nothing for every agent that is present, in the documented formats', () => {
    allAgents()
    const result = install()
    expect(result.items.filter((item) => item.action === 'error')).toEqual([])
    const layout = resolveLayout(home, {})

    // Instruction: a marker block in the global file of each agent.
    for (const file of [
      layout.instruction.claude,
      layout.instruction.codex,
      layout.instruction.opencode,
      layout.instruction.pi,
    ]) {
      const text = readFileSync(file, 'utf8')
      expect(text).toContain(BEGIN_MARKER)
      expect(text).toContain('## Portta host')
      expect(text.match(/<!-- BEGIN PORTTA -->/g)).toHaveLength(1)
    }
    expect(layout.instruction.claude).toBe(join(home, '.claude/CLAUDE.md'))
    expect(layout.instruction.opencode).toBe(join(home, '.config/opencode/AGENTS.md'))

    // Hook: SessionStart, no matcher, type command, an absolute script.
    for (const file of [layout.claudeSettings, layout.codexHooks]) {
      const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks.SessionStart
      expect(hooks).toEqual([{ hooks: [{ type: 'command', command: layout.hookScript, timeout: 10 }] }])
    }

    // The script carries absolute paths and runs for real.
    const script = readFileSync(layout.hookScript, 'utf8')
    expect(script).toContain(`PORTTA_NODE_PATH='${cli.node}'`)
    expect(script).toContain(`PORTTA_CLI_PATH='${cli.script}'`)
    expect(statSync(layout.hookScript).mode & 0o111).not.toBe(0)

    // Skills: real copies in ~/.agents/skills, and links for Claude Code.
    for (const name of SKILL_NAMES) {
      expect(readFileSync(join(layout.skillsRoot, name, 'SKILL.md'), 'utf8')).toContain(`name: ${name}`)
      expect(lstatSync(join(layout.claudeSkills, name)).isSymbolicLink()).toBe(true)
    }

    // Pi: an extension that runs the same script before the agent starts.
    const extension = readFileSync(layout.piExtension, 'utf8')
    expect(extension).toContain(`const HOOK = ${JSON.stringify(layout.hookScript)}`)
    expect(extension).toContain("pi.on('before_agent_start'")

    expect(result.notes.join(' ')).toMatch(/\/hooks/)
    expect(result.agents.every((agent) => agent.complete)).toBe(true)
  })

  it('is idempotent: a second install changes nothing and duplicates nothing', () => {
    allAgents()
    install()
    const before = snapshot(home)
    const again = install()
    expect(again.items.every((item) => item.action === 'none')).toBe(true)
    expect(snapshot(home)).toEqual(before)
  })

  it('preserves hooks that other tools wrote, and puts them back exactly on uninstall', () => {
    allAgents()
    const layout = resolveLayout(home, {})
    put(layout.claudeSettings, `${JSON.stringify(THIRD_PARTY, null, 2)}\n`)
    put(layout.codexHooks, `${JSON.stringify(THIRD_PARTY)}\n`)
    put(layout.instruction.claude, '# My rules\n\nBe brief.\n')

    install()
    const settings = JSON.parse(readFileSync(layout.claudeSettings, 'utf8'))
    expect(settings.theme).toBe('dark')
    expect(settings.hooks.Stop).toEqual(THIRD_PARTY.hooks.Stop)
    expect(settings.hooks.SessionStart[0]).toEqual(THIRD_PARTY.hooks.SessionStart[0])
    expect(settings.hooks.SessionStart).toHaveLength(2)
    expect(readFileSync(layout.instruction.claude, 'utf8')).toMatch(
      /^# My rules\n\nBe brief\.\n\n<!-- BEGIN PORTTA -->/,
    )

    install()
    expect(JSON.parse(readFileSync(layout.claudeSettings, 'utf8')).hooks.SessionStart).toHaveLength(2)

    uninstall()
    expect(JSON.parse(readFileSync(layout.claudeSettings, 'utf8'))).toEqual(THIRD_PARTY)
    expect(JSON.parse(readFileSync(layout.codexHooks, 'utf8'))).toEqual(THIRD_PARTY)
    expect(readFileSync(layout.instruction.claude, 'utf8')).toBe('# My rules\n\nBe brief.\n')
  })

  it('uninstall leaves nothing behind that the installer created', () => {
    allAgents()
    install()
    uninstall()
    // Only the directories that existed before remain, and they are empty.
    expect(snapshot(home)).toEqual({})
  })

  it('removing one agent keeps the skills and the script the others use', () => {
    allAgents()
    install()
    uninstall({ only: ['pi'] })
    const layout = resolveLayout(home, {})
    expect(existsSync(layout.piExtension)).toBe(false)
    expect(existsSync(layout.hookScript)).toBe(true)
    expect(existsSync(join(layout.skillsRoot, 'portta-host-context', 'SKILL.md'))).toBe(true)
    expect(readFileSync(layout.instruction.claude, 'utf8')).toContain(BEGIN_MARKER)
  })

  it('--dry-run reports the plan and writes nothing', () => {
    allAgents()
    const result = install({ dryRun: true })
    expect(result.dryRun).toBe(true)
    expect(result.items.some((item) => item.action === 'create')).toBe(true)
    expect(snapshot(home)).toEqual({})
    expect(uninstall({ dryRun: true }).items).toEqual([])
  })

  it('ignores an agent that is not there', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const result = install()
    expect(result.agents.find((agent) => agent.id === 'codex')).toMatchObject({ detected: false, complete: null })
    expect(existsSync(join(home, '.codex'))).toBe(false)
    expect(existsSync(join(home, '.pi'))).toBe(false)
    expect(existsSync(join(home, '.config/opencode'))).toBe(false)
    expect(existsSync(join(home, '.claude/CLAUDE.md'))).toBe(true)
  })

  it('writes nothing when no agent is found, and says how to name one', () => {
    const result = install()
    expect(snapshot(home)).toEqual({})
    expect(result.notes.join(' ')).toMatch(/portta agents install claude/)
    install({ only: ['claude'] })
    expect(existsSync(join(home, '.claude/CLAUDE.md'))).toBe(true)
  })

  it('--home wins over CLAUDE_CONFIG_DIR and CODEX_HOME', () => {
    allAgents()
    const elsewhere = temp()
    const env = { CLAUDE_CONFIG_DIR: join(elsewhere, 'claude'), CODEX_HOME: join(elsewhere, 'codex') }
    expect(resolveLayout(home, env).claudeSettings).toBe(join(home, '.claude/settings.json'))
    expect(resolveLayout(undefined, { ...env, HOME: home }).claudeSettings).toBe(
      join(elsewhere, 'claude/settings.json'),
    )
    install({ env })
    expect(readdirSync(elsewhere)).toEqual([])
    expect(existsSync(join(home, '.codex/hooks.json'))).toBe(true)
  })

  it('leaves a settings file that is not JSON alone, and says so', () => {
    allAgents()
    const layout = resolveLayout(home, {})
    put(layout.claudeSettings, '{ not json')
    const result = install()
    expect(readFileSync(layout.claudeSettings, 'utf8')).toBe('{ not json')
    expect(result.items.find((item) => item.path === layout.claudeSettings)).toMatchObject({ action: 'skip' })
    expect(readFileSync(layout.instruction.claude, 'utf8')).toContain(BEGIN_MARKER)
  })

  it('leaves a skill it did not install alone', () => {
    allAgents()
    const layout = resolveLayout(home, {})
    put(join(layout.skillsRoot, 'portta-adopt-compose', 'SKILL.md'), 'mine\n')
    install()
    expect(readFileSync(join(layout.skillsRoot, 'portta-adopt-compose', 'SKILL.md'), 'utf8')).toBe('mine\n')
    uninstall()
    expect(existsSync(join(layout.skillsRoot, 'portta-adopt-compose', 'SKILL.md'))).toBe(true)
  })

  it('replaces a stale block in place and keeps what surrounds it', () => {
    allAgents()
    const layout = resolveLayout(home, {})
    put(layout.instruction.codex, `before\n\n${BEGIN_MARKER}\nold text\n<!-- END PORTTA -->\n\nafter\n`)
    install()
    const text = readFileSync(layout.instruction.codex, 'utf8')
    expect(text).not.toContain('old text')
    expect(text.startsWith('before\n\n<!-- BEGIN PORTTA -->')).toBe(true)
    expect(text.endsWith('<!-- END PORTTA -->\n\nafter\n')).toBe(true)
  })
})

describe('portta agents status', () => {
  it('compares what is installed with what should be', () => {
    allAgents()
    expect(agentsStatus({ home, cli, env: {} }).ok).toBe(false)
    install()
    expect(agentsStatus({ home, cli, env: {} }).ok).toBe(true)
    const layout = resolveLayout(home, {})
    writeFileSync(
      layout.instruction.claude,
      readFileSync(layout.instruction.claude, 'utf8').replace('Never:', 'Sometimes:'),
    )
    const status = agentsStatus({ home, cli, env: {} })
    expect(status.ok).toBe(false)
    expect(status.items.find((item) => item.path === layout.instruction.claude)?.state).toBe('outdated')
  })

  it('doctor hears about an agent without the layer, and about nothing else', () => {
    const real = temp()
    mkdirSync(join(real, '.codex'), { recursive: true })
    expect(agentsNeedingLayer({ HOME: real, PATH: '' })).toEqual(['Codex'])
    expect(agentsNeedingLayer({ HOME: temp(), PATH: '' })).toEqual([])
  })
})

describe('the hook script', () => {
  function run(script: string, env: Record<string, string> = {}) {
    return spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } })
  }

  it('prints the context from the absolute CLI and always exits 0', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    install()
    const hook = resolveLayout(home, {}).hookScript
    const ok = run(hook)
    expect(ok.status).toBe(0)
    expect(ok.stdout).toContain('Portta host 0.2.0')

    // A CLI that crashes must not fail the session.
    writeFileSync(cli.script, 'process.exit(3)\n')
    expect(run(hook)).toMatchObject({ status: 0, stdout: '' })

    // A CLI that is gone is silent.
    rmSync(cli.script)
    expect(run(hook)).toMatchObject({ status: 0, stdout: '' })
  })

  it('works on a machine with no `timeout` command', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    install()
    const empty = temp()
    const result = run(resolveLayout(home, {}).hookScript, { PATH: empty })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Portta host 0.2.0')
  })

  it('quotes paths with spaces and quotes', () => {
    mkdirSync(join(home, '.claude'), { recursive: true })
    const script = put(join(temp(), "it's here", 'cli.js'), "console.log('quoted ok')\n")
    install({ cli: { node: process.execPath, script } })
    expect(run(resolveLayout(home, {}).hookScript).stdout).toContain('quoted ok')
  })
})

describe('the shipped skills follow the Agent Skills specification', () => {
  const root = resolve(locateAssets().skills)

  it.each(SKILL_NAMES)('%s', (name) => {
    const text = readFileSync(join(root, name, 'SKILL.md'), 'utf8')
    const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
    expect(match).not.toBeNull()
    const front = parse(match![1]!) as Record<string, unknown>
    const body = match![2]!
    expect(front.name).toBe(name)
    expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(name.length).toBeLessThanOrEqual(64)
    expect(typeof front.description).toBe('string')
    expect((front.description as string).length).toBeGreaterThan(0)
    expect((front.description as string).length).toBeLessThanOrEqual(1024)
    expect(String(front.compatibility ?? '').length).toBeLessThanOrEqual(500)
    expect(body.split('\n').length).toBeLessThanOrEqual(500)
    expect(text).not.toMatch(/[—–]/)
  })

  it('the adopt skill covers the public-host decision', () => {
    const text = readFileSync(join(root, 'portta-adopt-compose', 'SKILL.md'), 'utf8').replace(/\s+/g, ' ')
    for (const word of [
      'public_exposure',
      '--protect',
      '--public',
      'once',
      'created in the panel',
      'portta agent context',
    ])
      expect(text).toContain(word)
    expect(text).not.toMatch(/projects context|Taskflow/i)
  })
})
