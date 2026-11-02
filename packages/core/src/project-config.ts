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

import { z } from './zod.ts'

export const PROJECT_CONFIG_FILE = 'project.yaml'
export const PROJECT_CONFIG_PATH = `.portta/${PROJECT_CONFIG_FILE}`

export interface ProjectConfig {
  version: 1
  /** The project's own name. Null when it does not declare one; the directory decides. */
  name: string | null
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

// `.strict()` is the main guard, not a nicety: it is what refuses `domain:`,
// `url:`, `hostname:` or `port:` before any per-field rule has to recognise
// them. A field this schema does not know is a field nobody agreed travels.
const Schema = z.strictObject({
  version: z.literal(1),
  name: portable('the project name').optional(),
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
  return {
    ok: true,
    config: {
      version: 1,
      name: value.name ?? null,
      stack: value.stack ?? [],
      instructions: value.instructions ?? [],
    },
  }
}
