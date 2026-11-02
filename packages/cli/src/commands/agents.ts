// `portta agents install | status | uninstall`: the Portta layer in AI coding agents.
//
// Three layers, because skills alone only guarantee a name and a description at
// the start of a session and activating one is the model's decision:
//
//   1. an always-loaded instruction, in a marker block of the agent's global file
//   2. a deterministic hook that prints `portta agent context` at session start
//   3. skills, loaded on demand
//
// Everything is derived from one place, `inspect`, which compares what exists
// with what should exist. Install writes the difference, status reports it and
// uninstall removes only what the installer put there: the text between its
// markers, the hook entries that name its script, and the files it created.
// Nothing here touches the network or runs an agent.

import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve } from 'node:path'
import type { Command } from 'commander'
import { CliError, PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'

export const AGENT_IDS = ['claude', 'codex', 'opencode', 'pi'] as const
export type AgentId = (typeof AGENT_IDS)[number]
export const SKILL_NAMES = ['portta-host-context', 'portta-dockerize', 'portta-adopt-compose'] as const

export const BEGIN_MARKER = '<!-- BEGIN PORTTA -->'
export const END_MARKER = '<!-- END PORTTA -->'
const MANAGED_MARKER = '.portta-managed'
const HOOK_TIMEOUT_SECONDS = 10

const BINARIES: Record<AgentId, string> = { claude: 'claude', codex: 'codex', opencode: 'opencode', pi: 'pi' }
const TITLES: Record<AgentId, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi' }

export interface Layout {
  home: string
  /** `--home` was given: the home is a sandbox and only its directories say which agents exist. */
  sandboxed: boolean
  agentDirectory: Record<AgentId, string>
  instruction: Record<AgentId, string>
  skillsRoot: string
  claudeSkills: string
  claudeSettings: string
  codexHooks: string
  piExtension: string
  hookScript: string
}

/**
 * Where each agent keeps its files.
 *
 * An explicit `home` wins over `CLAUDE_CONFIG_DIR` and `CODEX_HOME`: a test or
 * a dry run pointed at a temporary home must never reach the real
 * configuration through an inherited variable.
 */
export function resolveLayout(home?: string, env: NodeJS.ProcessEnv = process.env): Layout {
  const base = resolve(home ?? env.HOME ?? homedir())
  const claude = !home && env.CLAUDE_CONFIG_DIR ? resolve(env.CLAUDE_CONFIG_DIR) : join(base, '.claude')
  const codex = !home && env.CODEX_HOME ? resolve(env.CODEX_HOME) : join(base, '.codex')
  const opencode = join(base, '.config', 'opencode')
  const pi = join(base, '.pi', 'agent')
  return {
    home: base,
    sandboxed: home !== undefined,
    agentDirectory: { claude, codex, opencode, pi },
    instruction: {
      claude: join(claude, 'CLAUDE.md'),
      codex: join(codex, 'AGENTS.md'),
      opencode: join(opencode, 'AGENTS.md'),
      pi: join(pi, 'AGENTS.md'),
    },
    skillsRoot: join(base, '.agents', 'skills'),
    claudeSkills: join(claude, 'skills'),
    claudeSettings: join(claude, 'settings.json'),
    codexHooks: join(codex, 'hooks.json'),
    piExtension: join(pi, 'extensions', 'portta-context.ts'),
    hookScript: join(base, '.config', 'portta', 'agents', 'hook.sh'),
  }
}

function onPath(binary: string, env: NodeJS.ProcessEnv): boolean {
  for (const entry of (env.PATH ?? '').split(delimiter).filter(Boolean)) {
    try {
      const file = join(entry, binary)
      if (statSync(file).isFile()) {
        accessSync(file, constants.X_OK)
        return true
      }
    } catch {}
  }
  return false
}

/** An agent is present when its binary is on `PATH` or its directory exists. */
export function detectAgents(layout: Layout, env: NodeJS.ProcessEnv = process.env): AgentId[] {
  return AGENT_IDS.filter(
    (id) => existsSync(layout.agentDirectory[id]) || (!layout.sandboxed && onPath(BINARIES[id], env)),
  )
}

export interface Assets {
  agents: string
  skills: string
}

/** The packaged assets in `dist/assets`, or the repository's own in a source checkout. */
export function locateAssets(): Assets {
  const packaged = join(import.meta.dirname, 'assets')
  if (existsSync(join(packaged, 'agents', 'instruction.md')))
    return { agents: join(packaged, 'agents'), skills: join(packaged, 'skills') }
  const source = {
    agents: resolve(import.meta.dirname, '..', '..', 'assets', 'agents'),
    skills: resolve(import.meta.dirname, '..', '..', '..', '..', 'skills'),
  }
  if (existsSync(join(source.agents, 'instruction.md'))) return source
  throw new PreconditionError('the agent assets are missing from this installation', 'reinstall @codions/portta')
}

export interface CliLocation {
  node: string
  script: string
}

/** Absolute paths, because a hook runs without the shell profile that would find `node` or `portta`. */
function currentCli(): CliLocation {
  const script = process.argv[1] ? realpathSync(process.argv[1]) : ''
  return { node: process.execPath, script }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

type ItemKind = 'instruction' | 'skill' | 'skill-link' | 'hook-script' | 'hook' | 'extension'
type State = 'ok' | 'missing' | 'outdated' | 'conflict'

interface Item {
  owner: AgentId | 'shared'
  kind: ItemKind
  name: string
  path: string
  state: State
  detail?: string
  /** Brings the item to the wanted state. Called only for `missing` and `outdated`. */
  write: () => void
  /** Removes what the installer put there. Called only for `ok` and `outdated`. */
  remove: () => void
}

function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function writeText(path: string, text: string, mode?: number): void {
  mkdirSync(dirname(path), { recursive: true })
  // Not a rename: an instruction file that is a symlink into a dotfiles
  // repository must stay a symlink.
  writeFileSync(path, text)
  if (mode !== undefined) chmodSync(path, mode)
}

// --- instruction blocks ------------------------------------------------------

function blockOf(assets: Assets): string {
  return `${BEGIN_MARKER}\n${readFileSync(join(assets.agents, 'instruction.md'), 'utf8').trim()}\n${END_MARKER}`
}

function findBlock(text: string): { start: number; end: number } | 'unbalanced' | null {
  const start = text.indexOf(BEGIN_MARKER)
  const end = text.indexOf(END_MARKER)
  if (start < 0 && end < 0) return null
  if (start < 0 || end < start || text.indexOf(BEGIN_MARKER, start + 1) >= 0) return 'unbalanced'
  return { start, end: end + END_MARKER.length }
}

function instructionItem(owner: AgentId, path: string, assets: Assets): Item {
  const wanted = blockOf(assets)
  const text = readIfExists(path)
  const found = text === null ? null : findBlock(text)
  const state: State =
    found === null
      ? 'missing'
      : found === 'unbalanced'
        ? 'conflict'
        : text!.slice(found.start, found.end) === wanted
          ? 'ok'
          : 'outdated'
  return {
    owner,
    kind: 'instruction',
    name: path.split('/').pop() ?? 'instruction',
    path,
    state,
    ...(found === 'unbalanced' ? { detail: 'the PORTTA markers are unbalanced; fix the file by hand' } : {}),
    write() {
      if (text === null || text.trim() === '') return writeText(path, `${wanted}\n`)
      if (found && found !== 'unbalanced')
        return writeText(path, text.slice(0, found.start) + wanted + text.slice(found.end))
      writeText(path, `${text.replace(/\s+$/, '')}\n\n${wanted}\n`)
    },
    remove() {
      if (text === null || !found || found === 'unbalanced') return
      const before = text.slice(0, found.start).replace(/\s+$/, '')
      const after = text.slice(found.end).replace(/^\s+/, '')
      const rest = before && after ? `${before}\n\n${after}` : before + after
      // A file holding nothing but the block was created by the installer.
      if (rest.trim() === '') rmSync(path, { force: true })
      else writeText(path, rest.endsWith('\n') ? rest : `${rest}\n`)
    },
  }
}

// --- skills ------------------------------------------------------------------

function treeOf(directory: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name !== MANAGED_MARKER) files.set(relative(directory, full), readFileSync(full))
    }
  }
  walk(directory)
  return files
}

function skillItem(layout: Layout, assets: Assets, name: string): Item {
  const source = join(assets.skills, name)
  const target = join(layout.skillsRoot, name)
  let state: State = 'missing'
  let detail: string | undefined
  let stat: ReturnType<typeof lstatSync> | null = null
  try {
    stat = lstatSync(target)
  } catch {}
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory() || !existsSync(join(target, MANAGED_MARKER))) {
      state = 'conflict'
      detail = 'a skill with this name exists and was not installed by Portta; it is left alone'
    } else {
      const wanted = treeOf(source)
      const present = treeOf(target)
      const same = wanted.size === present.size && [...wanted].every(([file, data]) => present.get(file)?.equals(data))
      state = same ? 'ok' : 'outdated'
    }
  }
  return {
    owner: 'shared',
    kind: 'skill',
    name,
    path: target,
    state,
    ...(detail ? { detail } : {}),
    write() {
      rmSync(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, { recursive: true })
      writeFileSync(
        join(target, MANAGED_MARKER),
        'Installed by `portta agents install`; `portta agents uninstall` removes it.\n',
      )
    },
    remove() {
      rmSync(target, { recursive: true, force: true })
    },
  }
}

function skillLinkItem(layout: Layout, name: string): Item {
  const link = join(layout.claudeSkills, name)
  const target = join(layout.skillsRoot, name)
  let state: State = 'missing'
  let detail: string | undefined
  try {
    const stat = lstatSync(link)
    if (stat.isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === target) state = 'ok'
    else {
      state = 'conflict'
      detail = 'something else is already at this path; it is left alone'
    }
  } catch {}
  return {
    owner: 'claude',
    kind: 'skill-link',
    name,
    path: link,
    state,
    ...(detail ? { detail } : {}),
    write() {
      mkdirSync(layout.claudeSkills, { recursive: true })
      symlinkSync(target, link)
    },
    remove() {
      unlinkSync(link)
    },
  }
}

// --- hook script and extension ----------------------------------------------

export function renderHookScript(assets: Assets, cli: CliLocation): string {
  return readFileSync(join(assets.agents, 'hook.sh.tmpl'), 'utf8')
    .replace('__PORTTA_NODE_PATH__', () => shellQuote(cli.node))
    .replace('__PORTTA_CLI_PATH__', () => shellQuote(cli.script))
}

const MANAGED_BY = 'Managed by Portta'

function hookScriptItem(layout: Layout, assets: Assets, cli: CliLocation): Item {
  const wanted = renderHookScript(assets, cli)
  const path = layout.hookScript
  const text = readIfExists(path)
  let state: State = 'missing'
  let detail: string | undefined
  if (text !== null) {
    if (!text.includes(MANAGED_BY)) {
      state = 'conflict'
      detail = 'a hook.sh that Portta did not write is already there; it is left alone'
    } else {
      const executable = (statSync(path).mode & 0o111) !== 0
      state = text === wanted && executable ? 'ok' : 'outdated'
    }
  }
  return {
    owner: 'shared',
    kind: 'hook-script',
    name: 'hook.sh',
    path,
    state,
    ...(detail ? { detail } : {}),
    write() {
      writeText(path, wanted, 0o755)
    },
    remove() {
      rmSync(path, { force: true })
      try {
        rmdirSync(dirname(path))
      } catch {}
    },
  }
}

function extensionItem(layout: Layout, assets: Assets): Item {
  const path = layout.piExtension
  const wanted = readFileSync(join(assets.agents, 'portta-context.ts.tmpl'), 'utf8').replace(
    '__PORTTA_HOOK_PATH__',
    () => JSON.stringify(layout.hookScript),
  )
  const text = readIfExists(path)
  let state: State = 'missing'
  let detail: string | undefined
  if (text !== null) {
    if (!text.includes(MANAGED_BY)) {
      state = 'conflict'
      detail = 'an extension with this name that Portta did not write is already there; it is left alone'
    } else state = text === wanted ? 'ok' : 'outdated'
  }
  return {
    owner: 'pi',
    kind: 'extension',
    name: 'portta-context.ts',
    path,
    state,
    ...(detail ? { detail } : {}),
    write() {
      writeText(path, wanted)
    },
    remove() {
      rmSync(path, { force: true })
    },
  }
}

// --- JSON hooks (Claude Code settings.json, Codex hooks.json) ----------------

type Json = Record<string, unknown>
interface Handler extends Json {
  type?: unknown
  command?: unknown
  timeout?: unknown
}
interface Group extends Json {
  hooks?: unknown
}

function isOurs(handler: unknown): boolean {
  const command = (handler as Handler | null)?.command
  return typeof command === 'string' && command.replace(/['"]/g, '').endsWith('/portta/agents/hook.sh')
}

function indentOf(text: string): number | string {
  return /^( +|\t)"/m.exec(text)?.[1] ?? 2
}

function wantedHandler(layout: Layout): Handler {
  const script = layout.hookScript
  const command = /^[\w@%+=:,./-]+$/.test(script) ? script : shellQuote(script)
  return { type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }
}

/** The SessionStart groups, or null when the file's shape is not the documented one. */
function sessionStartOf(document: Json): Group[] | null | undefined {
  const hooks = document.hooks
  if (hooks === undefined) return undefined
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return null
  const groups = (hooks as Json).SessionStart
  if (groups === undefined) return undefined
  return Array.isArray(groups) ? (groups as Group[]) : null
}

function handlersOf(group: Group): unknown[] {
  return Array.isArray(group.hooks) ? group.hooks : []
}

function jsonHookItem(owner: 'claude' | 'codex', path: string, layout: Layout): Item {
  const wanted = wantedHandler(layout)
  const text = readIfExists(path)
  let document: Json = {}
  let state: State = 'missing'
  let detail: string | undefined
  if (text !== null && text.trim() !== '') {
    try {
      const parsed = JSON.parse(text) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      document = parsed as Json
      const groups = sessionStartOf(document)
      if (groups === null) {
        state = 'conflict'
        detail = 'hooks.SessionStart is not an array; fix the file by hand'
      } else {
        const ours = (groups ?? []).flatMap(handlersOf).filter(isOurs) as Handler[]
        if (
          ours.length === 1 &&
          JSON.stringify(ours[0], Object.keys(wanted).sort()) === JSON.stringify(wanted, Object.keys(wanted).sort())
        )
          state = 'ok'
        else if (ours.length > 0) state = 'outdated'
      }
    } catch {
      state = 'conflict'
      detail = 'the file is not valid JSON; it is left alone'
    }
  }
  const indent = text === null ? 2 : indentOf(text)
  const save = (next: Json) => {
    if (Object.keys(next).length === 0) rmSync(path, { force: true })
    else writeText(path, `${JSON.stringify(next, null, indent)}\n`)
  }
  return {
    owner,
    kind: 'hook',
    name: `${path.split('/').pop()} SessionStart`,
    path,
    state,
    ...(detail ? { detail } : {}),
    write() {
      const next: Json = { ...document }
      const hooks: Json = { ...((next.hooks as Json | undefined) ?? {}) }
      const groups = [...((hooks.SessionStart as Group[] | undefined) ?? [])]
      let placed = false
      // Our handler is updated where it already is, and a duplicate dropped, so a
      // group a person arranged with other hooks keeps its shape.
      const merged = groups.flatMap((group) => {
        if (!handlersOf(group).some(isOurs)) return [group]
        const handlers = handlersOf(group).flatMap((handler) => {
          if (!isOurs(handler)) return [handler]
          if (placed) return []
          placed = true
          return [{ ...(handler as Handler), ...wanted }]
        })
        return handlers.length > 0 ? [{ ...group, hooks: handlers }] : []
      })
      if (!placed) merged.push({ hooks: [wanted] })
      hooks.SessionStart = merged
      next.hooks = hooks
      save(next)
    },
    remove() {
      const next: Json = { ...document }
      const hooks: Json = { ...((next.hooks as Json | undefined) ?? {}) }
      const groups = ((hooks.SessionStart as Group[] | undefined) ?? []).flatMap((group) => {
        if (!handlersOf(group).some(isOurs)) return [group]
        const rest = handlersOf(group).filter((handler) => !isOurs(handler))
        return rest.length > 0 ? [{ ...group, hooks: rest }] : []
      })
      if (groups.length > 0) hooks.SessionStart = groups
      else delete hooks.SessionStart
      if (Object.keys(hooks).length > 0) next.hooks = hooks
      else delete next.hooks
      save(next)
    },
  }
}

// --- the whole layer ----------------------------------------------------------

export interface InspectOptions {
  assets?: Assets
  cli?: CliLocation
}

/** Every item the layer consists of for these agents, each with what it is now. */
function inspect(layout: Layout, agents: readonly AgentId[], options: InspectOptions = {}): Item[] {
  const assets = options.assets ?? locateAssets()
  const cli = options.cli ?? currentCli()
  const items: Item[] = []
  if (agents.length > 0) for (const name of SKILL_NAMES) items.push(skillItem(layout, assets, name))
  if (agents.some((id) => id === 'claude' || id === 'codex' || id === 'pi'))
    items.push(hookScriptItem(layout, assets, cli))
  for (const id of agents) {
    items.push(instructionItem(id, layout.instruction[id], assets))
    if (id === 'claude') {
      for (const name of SKILL_NAMES) items.push(skillLinkItem(layout, name))
      items.push(jsonHookItem('claude', layout.claudeSettings, layout))
    }
    if (id === 'codex') items.push(jsonHookItem('codex', layout.codexHooks, layout))
    if (id === 'pi') items.push(extensionItem(layout, assets))
  }
  return items
}

export interface ItemReport {
  agent: AgentId | 'shared'
  kind: ItemKind
  name: string
  path: string
  state: State
  action: 'create' | 'update' | 'remove' | 'none' | 'skip' | 'error'
  detail?: string
}

export interface AgentReport {
  id: AgentId
  name: string
  detected: boolean
  /** Whether every item the layer has for this agent is in place. Null when the agent is neither present nor installed. */
  complete: boolean | null
  hook: 'SessionStart' | 'extension' | 'none'
}

export interface AgentsResult {
  home: string
  dryRun: boolean
  agents: AgentReport[]
  items: ItemReport[]
  notes: string[]
}

const HOOKS: Record<AgentId, AgentReport['hook']> = {
  claude: 'SessionStart',
  codex: 'SessionStart',
  opencode: 'none',
  pi: 'extension',
}

function reportOf(item: Item, action: ItemReport['action'], detail?: string): ItemReport {
  const shown = detail ?? item.detail
  return {
    agent: item.owner,
    kind: item.kind,
    name: item.name,
    path: item.path,
    state: item.state,
    action,
    ...(shown ? { detail: shown } : {}),
  }
}

function agentReports(layout: Layout, items: Item[], env: NodeJS.ProcessEnv): AgentReport[] {
  const detected = new Set(detectAgents(layout, env))
  return AGENT_IDS.map((id) => {
    const own = items.filter(
      (item) =>
        item.owner === id ||
        (item.owner === 'shared' && item.kind === 'skill') ||
        (item.owner === 'shared' && item.kind === 'hook-script' && HOOKS[id] !== 'none'),
    )
    const considered =
      own.length > 0 && (detected.has(id) || own.some((item) => item.owner === id && item.state !== 'missing'))
    return {
      id,
      name: TITLES[id],
      detected: detected.has(id),
      complete: considered ? own.every((item) => item.state === 'ok' || item.state === 'conflict') : null,
      hook: HOOKS[id],
    }
  })
}

function notesFor(agents: readonly AgentId[], items: Item[], cli: CliLocation): string[] {
  const notes: string[] = []
  if (agents.includes('codex') && items.some((item) => item.owner === 'codex' && item.kind === 'hook'))
    notes.push(
      'Codex runs a new or changed hook only after you review it: open /hooks in Codex and trust the Portta hook.',
    )
  if (agents.includes('opencode'))
    notes.push(
      'OpenCode gets the instruction and the skills only: its context plugin is not in the official documentation.',
    )
  if (/[\\/]_npx[\\/]/.test(cli.script))
    notes.push(
      'The CLI path points into an npx cache. Install @codions/portta globally and run `portta agents install` again.',
    )
  for (const item of items) if (item.state === 'conflict') notes.push(`${item.path}: ${item.detail ?? 'left alone'}`)
  return notes
}

export interface AgentsOptions extends InspectOptions {
  home?: string
  dryRun?: boolean
  /** Agents named by the person. Those are installed even when not detected. */
  only?: string[]
  env?: NodeJS.ProcessEnv
}

function named(only: string[] | undefined): AgentId[] | null {
  if (!only || only.length === 0) return null
  const unknown = only.filter((name) => !(AGENT_IDS as readonly string[]).includes(name))
  if (unknown.length > 0)
    throw new UsageError(`unknown agent: ${unknown.join(', ')}`, `use one of: ${AGENT_IDS.join(', ')}`)
  return AGENT_IDS.filter((id) => only.includes(id))
}

export function installAgents(options: AgentsOptions = {}): AgentsResult {
  const env = options.env ?? process.env
  const layout = resolveLayout(options.home, env)
  const cli = options.cli ?? currentCli()
  const selected = named(options.only) ?? detectAgents(layout, env)
  const items = inspect(layout, selected, { ...options, cli })
  const reports: ItemReport[] = []
  for (const item of items) {
    if (item.state === 'ok') reports.push(reportOf(item, 'none'))
    else if (item.state === 'conflict') reports.push(reportOf(item, 'skip'))
    else {
      const action = item.state === 'missing' ? 'create' : 'update'
      if (options.dryRun) reports.push(reportOf(item, action))
      else
        try {
          item.write()
          reports.push(reportOf(item, action))
        } catch (error) {
          reports.push(reportOf(item, 'error', error instanceof Error ? error.message : String(error)))
        }
    }
  }
  const notes = notesFor(selected, items, cli)
  if (selected.length === 0)
    notes.push(
      'No supported agent was found: nothing was written. Name one to install anyway, such as `portta agents install claude`.',
    )
  return {
    home: layout.home,
    dryRun: options.dryRun === true,
    agents: agentReports(layout, options.dryRun ? items : inspect(layout, selected, { ...options, cli }), env),
    items: reports,
    notes,
  }
}

export function agentsStatus(options: AgentsOptions = {}): AgentsResult & { ok: boolean } {
  const env = options.env ?? process.env
  const layout = resolveLayout(options.home, env)
  const cli = options.cli ?? currentCli()
  const present = named(options.only) ?? [...AGENT_IDS]
  const items = inspect(layout, present, { ...options, cli })
  const agents = agentReports(layout, items, env).filter((agent) => present.includes(agent.id))
  // An agent that is not there and has nothing of ours is not a problem, and its
  // missing items are not worth listing.
  const listed = new Set(agents.filter((agent) => agent.complete !== null).map((agent) => agent.id))
  const shown = items.filter((item) => item.owner === 'shared' || listed.has(item.owner as AgentId))
  const reports = shown.map((item) => reportOf(item, 'none'))
  const ok = agents.every((agent) => agent.complete !== false)
  return {
    home: layout.home,
    dryRun: false,
    agents,
    items: reports,
    notes: notesFor([...listed], items, cli),
    ok,
  }
}

export function uninstallAgents(options: AgentsOptions = {}): AgentsResult {
  const env = options.env ?? process.env
  const layout = resolveLayout(options.home, env)
  const cli = options.cli ?? currentCli()
  const everything = named(options.only) === null
  const selected = named(options.only) ?? [...AGENT_IDS]
  // The skills and the hook script serve every agent. They go only when the
  // whole layer goes, so removing one agent never breaks another.
  const items = inspect(layout, selected, { ...options, cli }).filter((item) => everything || item.owner !== 'shared')
  const reports: ItemReport[] = []
  for (const item of items) {
    if (item.state === 'missing') continue
    if (item.state === 'conflict') {
      reports.push(reportOf(item, 'skip'))
      continue
    }
    if (options.dryRun) reports.push(reportOf(item, 'remove'))
    else
      try {
        item.remove()
        reports.push(reportOf(item, 'remove'))
      } catch (error) {
        reports.push(reportOf(item, 'error', error instanceof Error ? error.message : String(error)))
      }
  }
  return {
    home: layout.home,
    dryRun: options.dryRun === true,
    agents: agentReports(layout, options.dryRun ? items : inspect(layout, selected, { ...options, cli }), env),
    items: reports,
    notes: reports.length === 0 ? ['Nothing installed by Portta was found.'] : [],
  }
}

/** For `portta doctor`: agents present on this machine whose layer is missing or incomplete. Read-only. */
export function agentsNeedingLayer(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const layout = resolveLayout(undefined, env)
    const present = detectAgents(layout, env)
    if (present.length === 0) return []
    const items = inspect(layout, present)
    return agentReports(layout, items, env)
      .filter((agent) => agent.detected && agent.complete === false)
      .map((agent) => agent.name)
  } catch {
    return []
  }
}

// --- commands ------------------------------------------------------------------

function globals(command: Command) {
  return command.optsWithGlobals() as { json?: boolean; quiet?: boolean; verbose?: boolean }
}

function printResult(
  result: AgentsResult & { ok?: boolean },
  output: Output,
  mode: 'install' | 'status' | 'uninstall',
): void {
  if (output.json) {
    output.data(result)
    return
  }
  output.line(`Home: ${result.home}${result.dryRun ? '   (dry run: nothing was written)' : ''}`)
  for (const agent of result.agents) {
    const state =
      agent.complete === null
        ? agent.detected
          ? 'nothing to do'
          : 'not found'
        : agent.complete
          ? 'installed'
          : 'incomplete'
    output.line(
      `${agent.name.padEnd(12)} ${agent.detected ? 'found    ' : 'not found'}  ${state}  (hook: ${agent.hook})`,
    )
  }
  for (const item of result.items) {
    const verb = mode === 'status' ? item.state : item.action
    output.line(`  ${verb.padEnd(9)} ${item.kind.padEnd(11)} ${item.path}${item.detail ? `   ${item.detail}` : ''}`)
  }
  for (const note of result.notes) output.line(`note: ${note}`)
}

function failOnErrors(result: AgentsResult): void {
  const failed = result.items.filter((item) => item.action === 'error')
  if (failed.length > 0)
    throw new CliError(`${failed.length} item(s) could not be written: ${failed.map((item) => item.path).join(', ')}`)
}

export interface AgentsCommandOptions {
  home?: string
  dryRun?: boolean
}

export function agentsInstallCommand(agents: string[], options: AgentsCommandOptions, command: Command): void {
  const result = installAgents({ ...options, only: agents })
  printResult(result, new Output(globals(command)), 'install')
  failOnErrors(result)
}

export function agentsStatusCommand(agents: string[], options: AgentsCommandOptions, command: Command): void {
  printResult(agentsStatus({ home: options.home, only: agents }), new Output(globals(command)), 'status')
}

export function agentsUninstallCommand(agents: string[], options: AgentsCommandOptions, command: Command): void {
  const result = uninstallAgents({ ...options, only: agents })
  printResult(result, new Output(globals(command)), 'uninstall')
  failOnErrors(result)
}
