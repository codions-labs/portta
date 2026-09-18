// The repositories of a Project: decisions, in their own module.
//
// A row here is what the operator registered: a name, where the code lives on
// the host, its remote, its role, and optionally the GitHub projection row it
// corresponds to. What the host scan observed about it (branch, commits,
// instruction files) is read from state/git at request time and never stored;
// `services/repositories.ts` joins the two.

import { posix } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { parseRemote } from 'portta-core'
import { z } from 'portta-core/zod'
import { type Db, repositories } from 'portta-db'

export const REPOSITORY_PROVIDERS = ['local', 'github', 'gitlab', 'bitbucket', 'other'] as const
export type RepositoryProvider = (typeof REPOSITORY_PROVIDERS)[number]

export interface RepositoryRecord {
  id: string
  projectId: string
  name: string
  role: string | null
  localPath: string | null
  relativePath: string | null
  remoteUrl: string | null
  provider: RepositoryProvider
  position: number
  createdAt: Date
  updatedAt: Date
}

/**
 * A record, and the forge coordinate derived from its remote.
 *
 * Derived rather than joined: there is no GitHub projection to join to any
 * more, and `owner/name` is already in `remote_url` — storing it a second time
 * would be a row that can disagree with the remote it came from (ADR 0018).
 */
export interface RepositoryRow extends RepositoryRecord {
  github: { slug: string; htmlUrl: string } | null
}

/** Which forge a remote belongs to, from its host. `local` when there is no remote. */
export function providerFor(remoteUrl: string | null | undefined): RepositoryProvider {
  if (!remoteUrl) return 'local'
  const value = remoteUrl.toLowerCase()
  if (/github\.com[/:]/.test(value)) return 'github'
  if (/gitlab\.com[/:]/.test(value) || /gitlab\./.test(value)) return 'gitlab'
  if (/bitbucket\.org[/:]/.test(value)) return 'bitbucket'
  return 'other'
}

const Name = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^\.?[A-Za-z0-9][A-Za-z0-9._ -]*$/,
    'a repository name is letters, digits, dots, dashes and spaces; a leading dot is allowed (.github)',
  )

/** Absolute, canonical, and never walking up. The panel cannot stat it; the host scan can. */
const LocalPath = z
  .string()
  .max(1024)
  .transform((value, ctx) => {
    const trimmed = value.trim()
    if (!trimmed.startsWith('/') || trimmed.includes('\0') || posix.normalize(trimmed).split('/').includes('..')) {
      ctx.addIssue({ code: 'custom', message: 'localPath must be an absolute path on the host that does not walk up' })
      return z.NEVER
    }
    const normalized = posix.normalize(trimmed).replace(/\/+$/, '')
    return normalized === '' ? '/' : normalized
  })

/** Inside the Project: `api`, `packages/web`. Never absolute, never `..`. */
const RelativePath = z
  .string()
  .max(255)
  .transform((value, ctx) => {
    const trimmed = value.trim()
    const normalized = posix.normalize(trimmed).replace(/^\.\//, '').replace(/\/+$/, '')
    if (
      trimmed === '' ||
      trimmed.startsWith('/') ||
      trimmed.includes('\0') ||
      normalized === '.' ||
      normalized.split('/').some((part) => part === '..' || part === '')
    ) {
      ctx.addIssue({ code: 'custom', message: 'relativePath must stay inside the Project: no leading slash, no ..' })
      return z.NEVER
    }
    return normalized
  })

const Role = z
  .string()
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/, 'a role is a lowercase word')
  .nullable()
const RemoteUrl = z.string().min(1).max(512).nullable()

export const CreateRepository = z
  .object({
    name: Name,
    role: Role.default(null),
    localPath: LocalPath.nullable().default(null),
    relativePath: RelativePath.nullable().default(null),
    remoteUrl: RemoteUrl.default(null),
    provider: z.enum(REPOSITORY_PROVIDERS).optional(),
    position: z.number().int().min(0).max(10_000).default(0),
  })
  .strict()

export const UpdateRepository = z
  .object({
    name: Name.optional(),
    role: Role.optional(),
    localPath: LocalPath.nullable().optional(),
    relativePath: RelativePath.nullable().optional(),
    remoteUrl: RemoteUrl.optional(),
    provider: z.enum(REPOSITORY_PROVIDERS).optional(),
    position: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
export type UpdateRepositoryInput = z.infer<typeof UpdateRepository>

function toRow(repository: typeof repositories.$inferSelect): RepositoryRow {
  const remote = repository.remoteUrl ? parseRemote(repository.remoteUrl) : null
  return {
    ...repository,
    id: String(repository.id),
    projectId: String(repository.projectId),
    github:
      remote?.kind === 'github' && remote.slug.includes('/') ? { slug: remote.slug, htmlUrl: remote.repoUrl } : null,
  }
}

export class RepositoriesRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async list(projectId?: string): Promise<RepositoryRow[]> {
    const rows =
      projectId === undefined
        ? await this.db
            .select()
            .from(repositories)
            .orderBy(asc(repositories.projectId), asc(repositories.position), asc(repositories.name))
        : await this.db
            .select()
            .from(repositories)
            .where(eq(repositories.projectId, Number(projectId)))
            .orderBy(asc(repositories.position), asc(repositories.name))
    return rows.map(toRow)
  }

  async find(id: string): Promise<RepositoryRow | null> {
    if (!/^\d+$/.test(id)) return null
    const [row] = await this.db
      .select()
      .from(repositories)
      .where(eq(repositories.id, Number(id)))
    return row ? toRow(row) : null
  }

  /**
   * The registered repository whose remote is this `owner/name`, when one is.
   *
   * A scan of the Project's own repositories rather than an indexed lookup: the
   * slug is parsed from a URL that can be written four different ways, so it is
   * not a column to compare against, and a Portta installation has tens of
   * repositories rather than thousands.
   */
  async findByGitHubSlug(slug: string): Promise<RepositoryRow | null> {
    const wanted = slug.toLowerCase()
    return (await this.list()).find((row) => row.github?.slug.toLowerCase() === wanted) ?? null
  }

  async create(projectId: string, input: unknown): Promise<RepositoryRow> {
    const parsed = CreateRepository.parse(input)
    const provider = parsed.provider ?? providerFor(parsed.remoteUrl)
    const [created] = await this.db
      .insert(repositories)
      .values({
        projectId: Number(projectId),
        name: parsed.name,
        role: parsed.role,
        localPath: parsed.localPath,
        relativePath: parsed.relativePath,
        remoteUrl: parsed.remoteUrl,
        provider,
        position: parsed.position,
      })
      .returning({ id: repositories.id })
    const row = created ? await this.find(String(created.id)) : null
    if (!row) throw new Error('database did not return the repository it created')
    return row
  }

  /** Three-valued on the nullable columns: absent leaves it, null clears it, a value sets it. */
  async update(id: string, patch: unknown): Promise<RepositoryRow | null> {
    const parsed = UpdateRepository.parse(patch)
    const current = await this.find(id)
    if (!current) return null
    const has = (key: keyof UpdateRepositoryInput) => Object.hasOwn(parsed, key)
    const next = {
      name: parsed.name ?? current.name,
      role: has('role') ? (parsed.role ?? null) : current.role,
      localPath: has('localPath') ? (parsed.localPath ?? null) : current.localPath,
      relativePath: has('relativePath') ? (parsed.relativePath ?? null) : current.relativePath,
      remoteUrl: has('remoteUrl') ? (parsed.remoteUrl ?? null) : current.remoteUrl,
      position: parsed.position ?? current.position,
    }
    const provider = parsed.provider ?? (has('remoteUrl') ? providerFor(next.remoteUrl) : current.provider)
    await this.db
      .update(repositories)
      .set({
        ...next,
        provider,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, Number(id)))
    return this.find(id)
  }

  /** Removes the registration. The clone, the remote and the GitHub row are untouched. */
  async remove(id: string): Promise<boolean> {
    if (!/^\d+$/.test(id)) return false
    const rows = await this.db
      .delete(repositories)
      .where(eq(repositories.id, Number(id)))
      .returning({ id: repositories.id })
    return rows.length > 0
  }
}
