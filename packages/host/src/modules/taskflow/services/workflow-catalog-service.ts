import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { JsonValue } from 'portta-contracts/taskflow'
import type { WorkflowSnapshotRecord } from 'portta-core/taskflow'
import { APP_NAME, APP_SLUG, PATH_NAMES } from 'portta-core/taskflow/config'
import { projectPaths } from 'portta-core/taskflow/paths'
import { KEY_VERSION, type Meta, parseWorkflow } from '../workflows/index.ts'

const MAX_WORKFLOW_BYTES = 524_288

export type WorkflowOrigin = 'builtin' | 'global' | 'project'
export type WorkflowDiagnosticCode =
  | 'invalid_workflow'
  | 'duplicate_definition'
  | 'bake_off_not_supported'
  | 'not_found'

export interface WorkflowCatalogDiagnostic {
  code: WorkflowDiagnosticCode
  message: string
  origin?: WorkflowOrigin
  path?: string
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  origin: WorkflowOrigin
  path: string
  contentHash: string
  source: string
  metadata: JsonValue
  keyVersion: string
}

export type WorkflowCatalogEntry =
  | { status: 'available'; definition: WorkflowDefinition }
  | { status: 'shadowed'; definition: WorkflowDefinition; shadowedBy: string }
  | { status: 'blocked'; definition: WorkflowDefinition; diagnostic: WorkflowCatalogDiagnostic }
  | { status: 'collision'; definition: WorkflowDefinition; diagnostic: WorkflowCatalogDiagnostic }
  | { status: 'invalid'; origin: WorkflowOrigin; path: string; diagnostic: WorkflowCatalogDiagnostic }

export interface WorkflowCatalogResult {
  entries: WorkflowCatalogEntry[]
  diagnostics: WorkflowCatalogDiagnostic[]
}

export interface WorkflowCatalogConfig {
  builtinRoot: string
  taskflowHome: string
  projectRoot: string
  engineVersion?: string
  keyVersion?: string
}

export type WorkflowResolution =
  | { ok: true; definition: WorkflowDefinition }
  | { ok: false; diagnostic: WorkflowCatalogDiagnostic }

export type WorkflowSnapshotResult =
  | { ok: true; snapshot: WorkflowSnapshotRecord }
  | { ok: false; diagnostic: WorkflowCatalogDiagnostic }

export interface CreateWorkflowSnapshotInput {
  id: string
  runId: string
  name: string
  createdAt: string
}

interface CatalogRoot {
  origin: WorkflowOrigin
  directory: string
  priority: number
}

interface CatalogCandidate {
  definition: WorkflowDefinition
  priority: number
}

function hash(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`
}

function metadataFor(meta: Meta, keyVersion: string): JsonValue {
  const metadata: Record<string, JsonValue> = {
    name: meta.name,
    description: meta.description,
    keyVersion,
  }
  if (meta.phases !== undefined) {
    metadata.phases = meta.phases.map((phase) => {
      const value: Record<string, JsonValue> = { title: phase.title }
      if (phase.detail !== undefined) value.detail = phase.detail
      return value
    })
  }
  if (meta.defaultSandbox !== undefined) metadata.defaultSandbox = meta.defaultSandbox
  if (meta.defaultProvider !== undefined) metadata.defaultProvider = meta.defaultProvider
  if (meta.defaultModel !== undefined) metadata.defaultModel = meta.defaultModel
  if (meta.whenToUse !== undefined) metadata.whenToUse = meta.whenToUse
  metadata.workspace =
    meta.workspace === undefined
      ? {
          default: 'isolated_worktree',
          allowed: ['isolated_worktree', 'new_branch', 'current_branch'],
          mutatesRepository: true,
          reason: 'Isolated worktrees are the safe default for workflows without an explicit workspace policy.',
        }
      : {
          default: meta.workspace.default,
          allowed: meta.workspace.allowed ?? ['isolated_worktree', 'new_branch', 'current_branch'],
          mutatesRepository: meta.workspace.mutatesRepository ?? true,
          ...(meta.workspace.reason === undefined ? {} : { reason: meta.workspace.reason }),
        }
  return metadata
}

function duplicateDiagnostic(name: string, origin: WorkflowOrigin): WorkflowCatalogDiagnostic {
  return {
    code: 'duplicate_definition',
    message: `Workflow "${name}" is declared more than once in the ${origin} catalog root`,
    origin,
  }
}

function rootsFor(config: WorkflowCatalogConfig): CatalogRoot[] {
  return [
    { origin: 'project', directory: projectPaths(resolve(config.projectRoot)).workflows, priority: 0 },
    { origin: 'global', directory: join(resolve(config.taskflowHome), PATH_NAMES.workflows), priority: 1 },
    { origin: 'builtin', directory: resolve(config.builtinRoot), priority: 2 },
  ]
}

export class WorkflowCatalogService {
  private readonly engineVersion: string
  private readonly keyVersion: string

  private readonly config: WorkflowCatalogConfig
  constructor(config: WorkflowCatalogConfig) {
    this.config = config
    this.engineVersion = config.engineVersion ?? `${APP_SLUG}-workflow-engine`
    this.keyVersion = config.keyVersion ?? KEY_VERSION
  }

  async discover(): Promise<WorkflowCatalogResult> {
    const diagnostics: WorkflowCatalogDiagnostic[] = []
    const candidates: CatalogCandidate[] = []
    const invalidEntries: WorkflowCatalogEntry[] = []
    for (const root of rootsFor(this.config)) {
      const scanned = await this.scanRoot(root)
      candidates.push(...scanned.candidates)
      diagnostics.push(...scanned.diagnostics)
      invalidEntries.push(...scanned.invalidEntries)
    }

    const byName = new Map<string, CatalogCandidate[]>()
    for (const candidate of candidates) {
      const existing = byName.get(candidate.definition.name)
      if (existing) existing.push(candidate)
      else byName.set(candidate.definition.name, [candidate])
    }

    const entries: WorkflowCatalogEntry[] = [...invalidEntries]
    for (const name of [...byName.keys()].sort()) {
      const matching = byName.get(name)
      if (!matching) continue
      const highestPriority = Math.min(...matching.map((candidate) => candidate.priority))
      const winners = matching.filter((candidate) => candidate.priority === highestPriority)
      const winner = winners[0]
      if (!winner) continue
      if (winners.length > 1) {
        const diagnostic = duplicateDiagnostic(name, winner.definition.origin)
        diagnostics.push(diagnostic)
        for (const candidate of matching) {
          entries.push(
            candidate.priority === highestPriority
              ? { status: 'collision', definition: candidate.definition, diagnostic }
              : {
                  status: 'shadowed',
                  definition: candidate.definition,
                  shadowedBy: `${winner.definition.origin}:collision`,
                },
          )
        }
        continue
      }
      entries.push({ status: 'available', definition: winner.definition })
      for (const candidate of matching) {
        if (candidate === winner) continue
        entries.push({ status: 'shadowed', definition: candidate.definition, shadowedBy: winner.definition.path })
      }
    }
    return { entries, diagnostics }
  }

  async resolve(name: string): Promise<WorkflowResolution> {
    const catalog = await this.discover()
    const available = catalog.entries.find((entry) => entry.status === 'available' && entry.definition.name === name)
    if (available?.status === 'available') return { ok: true, definition: available.definition }
    const blocked = catalog.entries.find((entry) => entry.status === 'blocked' && entry.definition.name === name)
    if (blocked?.status === 'blocked') return { ok: false, diagnostic: blocked.diagnostic }
    const collision = catalog.entries.find((entry) => entry.status === 'collision' && entry.definition.name === name)
    if (collision?.status === 'collision') return { ok: false, diagnostic: collision.diagnostic }
    return {
      ok: false,
      diagnostic: { code: 'not_found', message: `Workflow "${name}" was not found in the ${APP_NAME} catalog` },
    }
  }

  async createSnapshot(input: CreateWorkflowSnapshotInput): Promise<WorkflowSnapshotResult> {
    const resolved = await this.resolve(input.name)
    if (!resolved.ok) return resolved
    const definition = resolved.definition
    return {
      ok: true,
      snapshot: {
        id: input.id,
        runId: input.runId,
        definitionId: definition.id,
        name: definition.name,
        description: definition.description,
        origin: definition.origin,
        path: definition.path,
        contentHash: definition.contentHash,
        engineVersion: this.engineVersion,
        keyVersion: definition.keyVersion,
        source: definition.source,
        metadata: definition.metadata,
        createdAt: input.createdAt,
      },
    }
  }

  private async scanRoot(root: CatalogRoot): Promise<{
    candidates: CatalogCandidate[]
    diagnostics: WorkflowCatalogDiagnostic[]
    invalidEntries: WorkflowCatalogEntry[]
  }> {
    const candidates: CatalogCandidate[] = []
    const diagnostics: WorkflowCatalogDiagnostic[] = []
    const invalidEntries: WorkflowCatalogEntry[] = []
    let names: string[]
    try {
      names = (await readdir(root.directory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
        .map((entry) => entry.name)
    } catch {
      return { candidates, diagnostics, invalidEntries }
    }
    for (const name of names) {
      const path = join(root.directory, name)
      try {
        if ((await stat(path)).size > MAX_WORKFLOW_BYTES) {
          const diagnostic: WorkflowCatalogDiagnostic = {
            code: 'invalid_workflow',
            message: `Workflow file exceeds ${MAX_WORKFLOW_BYTES} bytes`,
            origin: root.origin,
            path,
          }
          diagnostics.push(diagnostic)
          invalidEntries.push({ status: 'invalid', origin: root.origin, path, diagnostic })
          continue
        }
        const source = await readFile(path, 'utf8')
        const parsed = parseWorkflow(source)
        const definition: WorkflowDefinition = {
          id: `${root.origin}:${hash(resolve(path))}`,
          name: parsed.meta.name,
          description: parsed.meta.description,
          origin: root.origin,
          path: resolve(path),
          contentHash: hash(source),
          source,
          metadata: metadataFor(parsed.meta, this.keyVersion),
          keyVersion: this.keyVersion,
        }
        candidates.push({ definition, priority: root.priority })
      } catch (error: unknown) {
        const diagnostic: WorkflowCatalogDiagnostic = {
          code: 'invalid_workflow',
          message: error instanceof Error ? error.message : 'Workflow metadata could not be read',
          origin: root.origin,
          path,
        }
        diagnostics.push(diagnostic)
        invalidEntries.push({ status: 'invalid', origin: root.origin, path, diagnostic })
      }
    }
    return { candidates, diagnostics, invalidEntries }
  }
}
