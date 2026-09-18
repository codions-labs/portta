import { basename, dirname, resolve } from 'node:path'
import type { Command } from 'commander'
import { parseGitWorktreePorcelain } from 'portta-host/taskflow/adapters/git'
import { runProcess } from '../../process.ts'
import { commandInvocation } from './flow-action.ts'

// ── Types ──────────────────────────────────────────────────────────────────

type CompletionShell = 'bash' | 'zsh'

interface GitResult {
  exitCode: number
  stdout: string
}

interface ListBranchesDeps {
  runGit: (args: string[]) => Promise<GitResult> | GitResult
}

/** What a positional argument completes to. */
type CompletionArgument = { kind: 'branch' } | { kind: 'choices'; values: readonly string[] } | { kind: 'none' }

/** A command as completion sees it: read from the commander tree, so a new
 *  command, alias, or argument completes without touching this file. */
export interface CompletionNode {
  name: string
  aliases: string[]
  description: string
  subcommands: CompletionNode[]
  arguments: CompletionArgument[]
}

// ── Pure logic ─────────────────────────────────────────────────────────────

export function extractBranches(porcelainOutput: string, mainWorktreePath: string | null): string[] {
  const entries = parseGitWorktreePorcelain(porcelainOutput)
  const resolvedMain = mainWorktreePath ? resolve(mainWorktreePath) : null

  return entries
    .filter((e) => !e.bare && (!resolvedMain || resolve(e.path) !== resolvedMain))
    .map((e) => e.branch ?? basename(e.path))
}

export function completionTree(command: Command): CompletionNode {
  const help = command.createHelp()
  return {
    name: command.name(),
    aliases: command.aliases(),
    description: command.description(),
    // `visibleCommands` also lists the implicit `help` command, which is not a real subcommand.
    subcommands: help
      .visibleCommands(command)
      .filter((subcommand) => command.commands.includes(subcommand))
      .map(completionTree),
    arguments: command.registeredArguments.map((argument): CompletionArgument => {
      if (argument.name() === 'branch') return { kind: 'branch' }
      if (argument.argChoices) return { kind: 'choices', values: argument.argChoices }
      return { kind: 'none' }
    }),
  }
}

// ── I/O boundary ───────────────────────────────────────────────────────────

async function defaultRunGit(args: string[]): Promise<GitResult> {
  const result = await runProcess('git', args, { reject: false })
  return { exitCode: result.exitCode, stdout: result.stdout.trim() }
}

export async function listWorktreeBranches(deps: ListBranchesDeps = { runGit: defaultRunGit }): Promise<string[]> {
  const worktreeResult = await deps.runGit(['worktree', 'list', '--porcelain'])
  if (worktreeResult.exitCode !== 0) return []

  const commonDirResult = await deps.runGit(['rev-parse', '--git-common-dir'])
  const mainPath = commonDirResult.exitCode === 0 ? dirname(resolve(commonDirResult.stdout)) : null

  return extractBranches(worktreeResult.stdout, mainPath)
}

// ── Completion handler (called by the generated scripts) ───────────────────

export async function handleCompletions(kind: string, deps?: ListBranchesDeps): Promise<number> {
  if (kind !== 'branches') return 0

  for (const branch of await listWorktreeBranches(deps)) {
    console.log(branch)
  }
  return 0
}

// ── Shell script generation ────────────────────────────────────────────────

export function runCompletionCommand(shell: string | undefined, root: Command): number {
  const invocation = commandInvocation(root)

  if (!shell) {
    console.log(
      [
        'Usage:',
        `  ${invocation} completion <bash|zsh>`,
        '',
        'Add this to your shell config to enable autocompletion:',
        '',
        '  # ~/.zshrc',
        `  eval "$(${invocation} completion zsh)"`,
        '',
        '  # ~/.bashrc',
        `  eval "$(${invocation} completion bash)"`,
      ].join('\n'),
    )
    return 0
  }

  if (shell !== 'bash' && shell !== 'zsh') {
    console.error(`Unknown shell: ${shell}. Supported: bash, zsh`)
    return 1
  }

  console.log(generateCompletionScript(shell, completionTree(root), invocation))
  return 0
}

function functionName(invocation: string): string {
  return `_${invocation.replace(/[^A-Za-z0-9]+/g, '_')}`
}

function casePattern(node: CompletionNode): string {
  return [node.name, ...node.aliases].join('|')
}

function zshQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function zshDescribe(label: string, nodes: CompletionNode[], indent: string): string[] {
  const items = nodes.map((node) => zshQuote(`${node.name}:${node.description.replace(/:/g, '\\:')}`))
  return [`${indent}local -a items`, `${indent}items=(${items.join(' ')})`, `${indent}_describe '${label}' items`]
}

function zshArgument(argument: CompletionArgument, invocation: string, indent: string): string[] {
  if (argument.kind === 'branch') {
    return [
      `${indent}local -a branches`,
      `${indent}branches=(\${(f)"$(${invocation} __complete branches 2>/dev/null)"})`,
      `${indent}(( \${#branches} )) && _describe 'worktree' branches`,
    ]
  }
  if (argument.kind === 'choices') {
    return [
      `${indent}local -a values`,
      `${indent}values=(${argument.values.join(' ')})`,
      `${indent}_describe 'value' values`,
    ]
  }
  return []
}

/** Lines completing `node`'s own words, where `depth` words below the flow
 *  command are already consumed by `node` and its parents. */
function zshNode(node: CompletionNode, invocation: string, base: number, depth: number, indent: string): string[] {
  const lines: string[] = []
  if (node.subcommands.length > 0) {
    lines.push(`${indent}if (( offset == ${depth} )); then`)
    lines.push(...zshDescribe(`${node.name} command`, node.subcommands, `${indent}  `))
    lines.push(`${indent}  return`, `${indent}fi`)
    lines.push(`${indent}case "\${words[${base + depth}]}" in`)
    for (const subcommand of node.subcommands) {
      const body = zshNode(subcommand, invocation, base, depth + 1, `${indent}    `)
      if (body.length === 0) continue
      lines.push(`${indent}  ${casePattern(subcommand)})`, ...body, `${indent}    ;;`)
    }
    lines.push(`${indent}esac`)
  }
  node.arguments.forEach((argument, index) => {
    const body = zshArgument(argument, invocation, `${indent}  `)
    if (body.length === 0) return
    lines.push(`${indent}if (( offset == ${depth + index} )); then`, ...body, `${indent}  return`, `${indent}fi`)
  })
  return lines
}

function bashWords(argument: CompletionArgument, invocation: string): string | null {
  if (argument.kind === 'branch') return `$(${invocation} __complete branches 2>/dev/null)`
  if (argument.kind === 'choices') return argument.values.join(' ')
  return null
}

function bashNode(node: CompletionNode, invocation: string, base: number, depth: number, indent: string): string[] {
  const lines: string[] = []
  if (node.subcommands.length > 0) {
    const names = node.subcommands.map((subcommand) => subcommand.name).join(' ')
    lines.push(
      `${indent}if [[ \${offset} -eq ${depth} ]]; then`,
      `${indent}  COMPREPLY=($(compgen -W "${names}" -- "\${cur}"))`,
      `${indent}  return`,
      `${indent}fi`,
      `${indent}case "\${COMP_WORDS[${base + depth}]}" in`,
    )
    for (const subcommand of node.subcommands) {
      const body = bashNode(subcommand, invocation, base, depth + 1, `${indent}    `)
      if (body.length === 0) continue
      lines.push(`${indent}  ${casePattern(subcommand)})`, ...body, `${indent}    ;;`)
    }
    lines.push(`${indent}esac`)
  }
  node.arguments.forEach((argument, index) => {
    const words = bashWords(argument, invocation)
    if (words === null) return
    lines.push(
      `${indent}if [[ \${offset} -eq ${depth + index} ]]; then`,
      `${indent}  COMPREPLY=($(compgen -W "${words}" -- "\${cur}"))`,
      `${indent}  return`,
      `${indent}fi`,
    )
  })
  return lines
}

/**
 * A completion script for the tree under `invocation` (`taskflow`, or
 * `portta flow` when embedded). Positions are counted from the first word below
 * that invocation, so the same tree completes at any depth.
 */
export function generateCompletionScript(shell: CompletionShell, tree: CompletionNode, invocation: string): string {
  const name = functionName(invocation)
  const words = invocation.split(' ')
  const program = words[0] ?? tree.name

  if (shell === 'zsh') {
    const base = words.length + 1
    return [
      `#compdef ${program}`,
      '',
      `${name}() {`,
      `  local offset=$(( CURRENT - ${base} ))`,
      '  (( offset >= 0 )) || return',
      ...zshNode(tree, invocation, base, 0, '  '),
      '}',
      '',
      `compdef ${name} ${program}`,
    ].join('\n')
  }

  const base = words.length
  return [
    `${name}() {`,
    '  local cur offset',
    '  COMPREPLY=()',
    `  cur="\${COMP_WORDS[COMP_CWORD]}"`,
    `  offset=$(( COMP_CWORD - ${base} ))`,
    `  [[ \${offset} -ge 0 ]] || return`,
    ...bashNode(tree, invocation, base, 0, '  '),
    '}',
    '',
    `complete -F ${name} ${program}`,
  ].join('\n')
}
