// What a project declares about itself, in `.portta/project.yaml`.
//
// The invariant this file makes executable is the one ADR 0052 states in
// prose: the document describes what the project *is and needs*, never *where
// it is running*. A domain, a URL, a published port or an absolute path in
// here would travel with the clone and be wrong on the next machine, so they
// are refused rather than ignored.
//
// It deliberately carries no services, ports, Compose files or profiles.
// Those describe how the runtime comes up and already live in
// `.portta/runtime.json`; a second copy here would be two answers to one
// question. See docs/product/reference/portta-directory.md.

import { z } from 'zod'

export const PROJECT_CONFIG_FILE = 'project.yaml'
export const PROJECT_CONFIG_PATH = `.portta/${PROJECT_CONFIG_FILE}`

/** What a project gets when it declares nothing. */
export const PROJECT_CONFIG_DEFAULTS = {
  worktreeRoot: '.portta/worktrees',
  branchPattern: '{type}/{slug}',
} as const

/** The placeholders a branch pattern may use. Anything else is refused: an
 *  unknown one is either a typo that would land in a branch name literally, or
 *  a host-shaped value trying to get in through a template. */
export const BRANCH_PATTERN_PLACEHOLDERS = ['type', 'slug'] as const

/** The working-agreement types a branch may start with. The pattern fills `{type}`. */
export const BRANCH_TYPES = ['fix', 'feat', 'refactor', 'docs'] as const
export type BranchType = (typeof BRANCH_TYPES)[number]

export function isBranchType(value: string): value is BranchType {
  return (BRANCH_TYPES as readonly string[]).includes(value)
}

/** Fill `{type}` and `{slug}` in a pattern the project already accepted. */
export function applyBranchPattern(pattern: string, values: { type: string; slug: string }): string {
  return pattern.replaceAll('{type}', values.type).replaceAll('{slug}', values.slug)
}

/** Two to four kebab-case words from a title, which is what a branch slug is. */
export function slugFromTitle(title: string): string {
  const words = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
    .slice(0, 4)
  return (words.length > 0 ? words : ['work']).join('-')
}

export function proposedIssueBranch(pattern: string, title: string, type: string = 'fix'): string {
  return applyBranchPattern(pattern, { type, slug: slugFromTitle(title) })
}

export interface ProjectConfig {
  version: 1
  /** The project's own name. Null when it does not declare one; the directory decides. */
  name: string | null
  /** The branch work is cut from. Null when it does not declare one. */
  mainBranch: string | null
  worktrees: { root: string; branchPattern: string }
  /** Informative only: what the project is built with. Never decides behaviour. */
  stack: string[]
  /** Which instruction files an agent should read here. */
  instructions: string[]
}

export interface ProjectConfigIssue {
  /** Dotted path into the document, or `''` for the document itself. */
  path: string
  message: string
}

export type ProjectConfigResult = { ok: true; config: ProjectConfig } | { ok: false; issues: ProjectConfigIssue[] }

/** A value that names a machine rather than the project. The check is
 *  deliberately narrow: it catches what is unambiguous, and the schema's
 *  strictness catches the rest by refusing keys like `domain` or `port`
 *  outright. */
function hostShape(value: string): string | null {
  if (/:\/\//.test(value)) return 'looks like a URL'
  if (value.startsWith('//')) return 'looks like a URL'
  if (value.startsWith('/')) return 'is an absolute path'
  if (/^[a-z]:[\\/]/i.test(value)) return 'is an absolute path'
  if (value.startsWith('~')) return 'is a home-relative path, which differs per machine'
  if (/^\d{1,5}:\d{1,5}$/.test(value)) return 'looks like a published host port'
  return null
}

const portable = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .superRefine((value, ctx) => {
      const shape = hostShape(value)
      if (shape) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} ${shape}; that belongs to the host, not to the project (ADR 0052)`,
        })
      }
    })

/** A path the clone carries: relative to the repository root, and inside it. */
const repoRelativePath = (label: string) =>
  portable(label).superRefine((value, ctx) => {
    const normalized = value.replaceAll('\\', '/')
    if (normalized.split('/').includes('..')) {
      ctx.addIssue({ code: 'custom', message: `${label} escapes the repository with '..'` })
    }
  })

const branchPattern = portable('the branch pattern').superRefine((value, ctx) => {
  const used = [...value.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? '')
  const allowed = new Set<string>(BRANCH_PATTERN_PLACEHOLDERS)
  for (const placeholder of used) {
    if (!allowed.has(placeholder)) {
      ctx.addIssue({
        code: 'custom',
        message: `unknown placeholder {${placeholder}}; the branch pattern accepts ${BRANCH_PATTERN_PLACEHOLDERS.map((name) => `{${name}}`).join(' and ')}`,
      })
    }
  }
})

// `.strict()` is the main guard, not a nicety: it is what refuses `domain:`,
// `url:`, `hostname:` or `port:` before any per-field rule has to recognise
// them. A field this schema does not know is a field nobody agreed travels.
const Schema = z.strictObject({
  version: z.literal(1),
  name: portable('the project name').optional(),
  mainBranch: portable('the main branch').optional(),
  worktrees: z
    .strictObject({
      root: repoRelativePath('the worktree root').optional(),
      branchPattern: branchPattern.optional(),
    })
    .optional(),
  stack: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .regex(/^[a-z0-9][a-z0-9.+-]*$/i, 'a stack entry is a plain identifier such as node or mysql'),
    )
    .optional(),
  instructions: z.array(repoRelativePath('an instruction path')).optional(),
})

/** What a project gets when it has no `project.yaml`, which is a normal case. */
export function defaultProjectConfig(): ProjectConfig {
  return {
    version: 1,
    name: null,
    mainBranch: null,
    worktrees: {
      root: PROJECT_CONFIG_DEFAULTS.worktreeRoot,
      branchPattern: PROJECT_CONFIG_DEFAULTS.branchPattern,
    },
    stack: [],
    instructions: [],
  }
}

/** Validate a parsed `project.yaml` document and fill in what it left out.
 *  Returns issues rather than throwing: a malformed file is something to
 *  report next to the rest of a report, not a reason to abort it. */
export function parseProjectConfig(document: unknown): ProjectConfigResult {
  if (document === null || document === undefined) {
    return { ok: false, issues: [{ path: '', message: `${PROJECT_CONFIG_FILE} is empty` }] }
  }
  const parsed = Schema.safeParse(document)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    }
  }
  const value = parsed.data
  const defaults = defaultProjectConfig()
  return {
    ok: true,
    config: {
      version: 1,
      name: value.name ?? null,
      mainBranch: value.mainBranch ?? null,
      worktrees: {
        root: value.worktrees?.root ?? defaults.worktrees.root,
        branchPattern: value.worktrees?.branchPattern ?? defaults.worktrees.branchPattern,
      },
      stack: value.stack ?? [],
      instructions: value.instructions ?? [],
    },
  }
}
