import { join } from 'node:path'
import type { WorkspaceAccess, WorkspaceSelection, WorkspaceStrategy } from 'portta-contracts/taskflow'
import type { AgentId, RunRecord, RuntimeKind, WorkspaceLeaseRecord } from 'portta-core/taskflow'
import { APP_SLUG } from 'portta-core/taskflow/config'
import { canonicalizeFsPath, type GitGateway, sameFsPath } from '../adapters/git.ts'
import type { RunStore } from '../adapters/run-store.ts'
import {
  type CreateManagedWorktreeDependencies,
  type CreateManagedWorktreeOptions,
  createManagedWorktree,
} from './worktree-service.ts'

export interface WorkspaceBinding {
  workspaceId: string
  path: string
  canonicalPath: string
  branch: string
  baseBranch: string
  baseCommit: string
  strategy: WorkspaceStrategy
  access: WorkspaceAccess
}

export type WorkspaceReconciliation = 'attached' | 'missing' | 'foreign' | 'none'

export type WorkspaceFacadeResult =
  | { ok: true; run: RunRecord; workspace: WorkspaceBinding | null; lease?: WorkspaceLeaseRecord; replayed: boolean }
  | {
      ok: false
      reason:
        | 'not_found'
        | 'invalid_run_state'
        | 'workspace_already_reserved'
        | 'branch_conflict'
        | 'workspace_path_conflict'
        | 'foreign_workspace'
        | 'confirmation_required'
        | 'parent_workspace_missing'
        | 'lease_conflict'
        | 'lease_not_found'
        | 'dirty_workspace'
        | 'checkout_busy'
        | 'detached_head'
    }

export interface AcquireForkInput {
  leaseId: string
  runId: string
  executionId?: string | null
  projectRoot: string
  workspaceRoot: string
  slug: string
  profile: string
  agent: AgentId
  runtime: RuntimeKind
}

export interface WorkspaceLeaseSummary {
  leaseId: string
  branch: string
  baseCommit: string
  head: string | null
  dirty: boolean
  aheadCount: number
}

export interface ProvisionWorkspaceInput {
  runId: string
  projectRoot: string
  workspaceRoot: string
  baseBranch: string
  baseCommit: string
  profile: string
  agent: AgentId
  runtime: RuntimeKind
  workspace?: WorkspaceSelection
  access?: WorkspaceAccess
  issueRef?: string | null
}

export interface WorkspaceFacadeDependencies {
  store: RunStore
  git: GitGateway
  createManagedWorktree?: (
    options: CreateManagedWorktreeOptions,
    dependencies: CreateManagedWorktreeDependencies,
  ) => Promise<unknown>
  reconcile?: (repoRoot: string) => Promise<void>
  now?: () => Date
}

function workspaceBindingFor(
  runId: string,
  projectRoot: string,
  workspaceRoot: string,
  baseBranch: string,
  baseCommit: string,
  workspace: WorkspaceSelection,
  access: WorkspaceAccess,
): WorkspaceBinding {
  const segment =
    runId
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'run'
  if (workspace.strategy !== 'isolated_worktree') {
    const branch =
      workspace.strategy === 'current_branch' ? '' : workspace.branch?.trim() || `${APP_SLUG}/run-${segment}`
    return {
      workspaceId: `workspace_${runId}`,
      path: projectRoot,
      canonicalPath: canonicalizeFsPath(projectRoot),
      branch,
      baseBranch: workspace.strategy === 'new_branch' ? workspace.baseBranch?.trim() || baseBranch : baseBranch,
      baseCommit,
      strategy: workspace.strategy,
      access,
    }
  }
  const name = `${APP_SLUG}-run-${segment}`
  const path = join(workspaceRoot, name)
  return {
    workspaceId: `workspace_${runId}`,
    path,
    canonicalPath: canonicalizeFsPath(path),
    branch: workspace.branch?.trim() || `${APP_SLUG}/run-${segment}`,
    baseBranch: workspace.baseBranch?.trim() || baseBranch,
    baseCommit,
    strategy: workspace.strategy,
    access,
  }
}

function slugSegment(value: string, fallback: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  )
}

function forkBindingFor(run: RunRecord, workspaceRoot: string, slug: string): WorkspaceBinding {
  const runSegment = slugSegment(run.id, 'run')
  const forkSegment = slugSegment(slug, 'fork')
  const path = join(workspaceRoot, `${APP_SLUG}-run-${runSegment}-fork-${forkSegment}`)
  return {
    workspaceId: `workspace_lease_${run.id}_${forkSegment}`,
    path,
    canonicalPath: canonicalizeFsPath(path),
    branch: `${APP_SLUG}/run-${runSegment}-fork-${forkSegment}`,
    baseBranch: run.baseBranch ?? 'HEAD',
    baseCommit: run.baseCommit ?? '',
    strategy: 'isolated_worktree',
    access: 'exclusive_write',
  }
}

function bindingFromLease(lease: WorkspaceLeaseRecord): WorkspaceBinding {
  return {
    workspaceId: lease.workspaceId,
    path: lease.worktreePath,
    canonicalPath: lease.canonicalWorkspacePath,
    branch: lease.branch,
    baseBranch: lease.baseBranch,
    baseCommit: lease.baseCommit,
    strategy: 'isolated_worktree',
    access: 'exclusive_write',
  }
}

export function workspaceBindingFromRun(run: RunRecord): WorkspaceBinding | null {
  if (
    run.workspaceId === null ||
    run.worktreePath === null ||
    run.canonicalWorkspacePath === null ||
    run.branch === null ||
    run.baseBranch === null ||
    run.baseCommit === null
  )
    return null
  return {
    workspaceId: run.workspaceId,
    path: run.worktreePath,
    canonicalPath: run.canonicalWorkspacePath,
    branch: run.branch,
    baseBranch: run.baseBranch,
    baseCommit: run.baseCommit,
    strategy: run.workspaceStrategy ?? 'isolated_worktree',
    access: run.workspaceAccess ?? 'exclusive_write',
  }
}

export class WorkspaceFacade {
  private readonly createManagedWorktree: NonNullable<WorkspaceFacadeDependencies['createManagedWorktree']>
  private readonly now: () => Date

  private readonly deps: WorkspaceFacadeDependencies
  constructor(deps: WorkspaceFacadeDependencies) {
    this.deps = deps
    this.createManagedWorktree = deps.createManagedWorktree ?? createManagedWorktree
    this.now = deps.now ?? (() => new Date())
  }

  reserve(input: ProvisionWorkspaceInput): WorkspaceFacadeResult {
    const run = this.deps.store.getRun(input.runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    if (run.workspacePolicy === 'none') return { ok: true, run, workspace: null, replayed: true }
    const workspace = input.workspace ?? { strategy: 'isolated_worktree' }
    const access = input.access ?? 'exclusive_write'
    const currentBranch = this.deps.git.currentBranch(input.projectRoot)
    if (workspace.strategy === 'current_branch' && currentBranch.length === 0)
      return { ok: false, reason: 'detached_head' }
    if (workspace.strategy === 'new_branch' && this.deps.git.readStatus(input.projectRoot).length > 0) {
      return { ok: false, reason: 'dirty_workspace' }
    }
    const effectiveBase =
      workspace.strategy === 'current_branch' ? currentBranch : workspace.baseBranch?.trim() || input.baseBranch
    const baseCommit = this.deps.git.resolveCommit(input.projectRoot, effectiveBase)
    const binding = workspaceBindingFor(
      input.runId,
      input.projectRoot,
      input.workspaceRoot,
      effectiveBase,
      baseCommit,
      workspace,
      access,
    )
    if (workspace.strategy === 'current_branch') binding.branch = currentBranch
    if (workspace.strategy !== 'isolated_worktree') {
      const claim = this.deps.store.acquireCheckoutClaim({
        runId: input.runId,
        projectId: run.projectId,
        canonicalPath: binding.canonicalPath,
        access,
        createdAt: this.now().toISOString(),
      })
      if (!claim.ok) return { ok: false, reason: 'checkout_busy' }
    }
    const reserved = this.deps.store.reserveWorkspace({
      runId: input.runId,
      workspaceId: binding.workspaceId,
      worktreePath: binding.path,
      canonicalWorkspacePath: binding.canonicalPath,
      branch: binding.branch,
      baseBranch: binding.baseBranch,
      baseCommit: binding.baseCommit,
      strategy: binding.strategy,
      access: binding.access,
      updatedAt: this.now().toISOString(),
    })
    if (!reserved.ok && workspace.strategy !== 'isolated_worktree') this.deps.store.releaseCheckoutClaim(input.runId)
    return reserved.ok
      ? { ok: true, run: reserved.run, workspace: workspaceBindingFromRun(reserved.run), replayed: reserved.replayed }
      : reserved
  }

  async provision(input: ProvisionWorkspaceInput): Promise<WorkspaceFacadeResult> {
    const reserved = this.reserve(input)
    if (!reserved.ok || reserved.workspace === null) return reserved
    const workspace = reserved.workspace
    if (workspace.strategy === 'current_branch') return reserved
    if (workspace.strategy === 'new_branch') {
      if (reserved.replayed) {
        return this.deps.git.currentBranch(input.projectRoot) === workspace.branch
          ? reserved
          : { ok: false, reason: 'foreign_workspace' }
      }
      try {
        this.deps.git.createAndSwitchBranch(input.projectRoot, workspace.branch, workspace.baseCommit)
        return reserved
      } catch {
        this.deps.store.releaseCheckoutClaim(input.runId)
        return { ok: false, reason: 'branch_conflict' }
      }
    }
    const existing = this.deps.git
      .listWorktrees(input.projectRoot)
      .find((entry) => sameFsPath(entry.path, workspace.canonicalPath))
    if (existing) {
      if (existing.branch !== workspace.branch) return { ok: false, reason: 'foreign_workspace' }
      return reserved
    }
    await this.createManagedWorktree(
      {
        repoRoot: input.projectRoot,
        worktreePath: workspace.path,
        branch: workspace.branch,
        mode: 'new',
        baseBranch: workspace.baseBranch,
        profile: input.profile,
        agent: input.agent,
        runtime: input.runtime,
        worktreeId: workspace.workspaceId,
        runId: input.runId,
        ...(input.issueRef ? { issueRef: input.issueRef } : {}),
      },
      { git: this.deps.git },
    )
    await this.deps.reconcile?.(input.projectRoot)
    return reserved
  }

  reconcile(runId: string, projectRoot: string): WorkspaceReconciliation {
    const run = this.deps.store.getRun(runId)
    if (run === null || run.workspacePolicy === 'none') return 'none'
    const binding = workspaceBindingFromRun(run)
    if (binding === null) return 'missing'
    if (binding.strategy !== 'isolated_worktree') {
      return sameFsPath(projectRoot, binding.canonicalPath) &&
        this.deps.git.currentBranch(projectRoot) === binding.branch
        ? 'attached'
        : 'foreign'
    }
    const existing = this.deps.git
      .listWorktrees(projectRoot)
      .find((entry) => sameFsPath(entry.path, binding.canonicalPath))
    if (!existing) return 'missing'
    return existing.branch === binding.branch ? 'attached' : 'foreign'
  }

  preserve(runId: string): WorkspaceFacadeResult {
    const run = this.deps.store.getRun(runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    return { ok: true, run, workspace: workspaceBindingFromRun(run), replayed: true }
  }

  releaseCheckout(runId: string): void {
    this.deps.store.releaseCheckoutClaim(runId)
  }

  acquireCheckout(runId: string): boolean {
    const run = this.deps.store.getRun(runId)
    if (run === null || (run.workspaceStrategy ?? 'isolated_worktree') === 'isolated_worktree') return run !== null
    if (run.canonicalWorkspacePath === null) return false
    return this.deps.store.acquireCheckoutClaim({
      runId,
      projectId: run.projectId,
      canonicalPath: run.canonicalWorkspacePath,
      access: run.workspaceAccess ?? 'exclusive_write',
      createdAt: this.now().toISOString(),
    }).ok
  }

  async remove(runId: string, projectRoot: string, confirmed: boolean): Promise<WorkspaceFacadeResult> {
    if (!confirmed) return { ok: false, reason: 'confirmation_required' }
    const run = this.deps.store.getRun(runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    const binding = workspaceBindingFromRun(run)
    if (binding === null) return { ok: true, run, workspace: null, replayed: true }
    if (binding.strategy !== 'isolated_worktree') {
      this.deps.store.releaseCheckoutClaim(runId)
      return { ok: true, run, workspace: binding, replayed: true }
    }
    const existing = this.deps.git
      .listWorktrees(projectRoot)
      .find((entry) => sameFsPath(entry.path, binding.canonicalPath))
    if (existing && existing.branch !== binding.branch) return { ok: false, reason: 'foreign_workspace' }
    if (existing) {
      this.deps.git.removeWorktree({ repoRoot: projectRoot, worktreePath: binding.path, force: true })
      this.deps.git.deleteBranch(projectRoot, binding.branch, true)
    }
    await this.deps.reconcile?.(projectRoot)
    return { ok: true, run, workspace: binding, replayed: !existing }
  }

  listChildLeases(runId: string): WorkspaceLeaseRecord[] {
    return this.deps.store.listLeases(runId)
  }

  reconcileLease(leaseId: string, projectRoot: string): WorkspaceReconciliation {
    const lease = this.deps.store.getLease(leaseId)
    if (lease === null || lease.status === 'released') return 'none'
    const existing = this.deps.git
      .listWorktrees(projectRoot)
      .find((entry) => sameFsPath(entry.path, lease.canonicalWorkspacePath))
    if (!existing) return 'missing'
    return existing.branch === lease.branch ? 'attached' : 'foreign'
  }

  summarizeLease(leaseId: string, projectRoot: string): WorkspaceLeaseSummary | null {
    const lease = this.deps.store.getLease(leaseId)
    if (lease === null) return null
    const existing = this.deps.git
      .listWorktrees(projectRoot)
      .find((entry) => sameFsPath(entry.path, lease.canonicalWorkspacePath))
    const status = this.deps.git.readWorktreeStatus(existing?.path ?? lease.worktreePath)
    return {
      leaseId: lease.id,
      branch: lease.branch,
      baseCommit: lease.baseCommit,
      head: existing?.head ?? status.currentCommit,
      dirty: status.dirty,
      aheadCount: status.aheadCount,
    }
  }

  async acquireFork(input: AcquireForkInput): Promise<WorkspaceFacadeResult> {
    const run = this.deps.store.getRun(input.runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    if (run.workspaceId === null || run.baseCommit === null) return { ok: false, reason: 'parent_workspace_missing' }
    const binding = forkBindingFor(run, input.workspaceRoot, input.slug)
    const reserved = this.deps.store.reserveChildLease({
      id: input.leaseId,
      runId: input.runId,
      executionId: input.executionId ?? null,
      parentWorkspaceId: run.workspaceId,
      workspaceId: binding.workspaceId,
      worktreePath: binding.path,
      canonicalWorkspacePath: binding.canonicalPath,
      branch: binding.branch,
      baseBranch: binding.baseBranch,
      baseCommit: run.baseCommit,
      createdAt: this.now().toISOString(),
    })
    if (!reserved.ok) return reserved
    const lease = reserved.lease
    if (lease.status === 'preserved' || lease.status === 'released') {
      return { ok: true, run, workspace: bindingFromLease(lease), lease, replayed: reserved.replayed }
    }
    const existing = this.deps.git
      .listWorktrees(input.projectRoot)
      .find((entry) => sameFsPath(entry.path, lease.canonicalWorkspacePath))
    if (existing) {
      if (existing.branch !== lease.branch) return { ok: false, reason: 'foreign_workspace' }
      const active = this.deps.store.updateLeaseStatus(lease.id, 'active', this.now().toISOString()) ?? lease
      return { ok: true, run, workspace: bindingFromLease(active), lease: active, replayed: reserved.replayed }
    }
    try {
      await this.createManagedWorktree(
        {
          repoRoot: input.projectRoot,
          worktreePath: lease.worktreePath,
          branch: lease.branch,
          mode: 'new',
          baseBranch: lease.baseCommit,
          startPoint: lease.baseCommit,
          profile: input.profile,
          agent: input.agent,
          runtime: input.runtime,
          worktreeId: lease.workspaceId,
          runId: input.runId,
          deleteBranchOnRollback: true,
        },
        { git: this.deps.git },
      )
    } catch {
      this.deps.store.deleteLease(lease.id)
      return { ok: false, reason: 'workspace_path_conflict' }
    }
    await this.deps.reconcile?.(input.projectRoot)
    const active = this.deps.store.updateLeaseStatus(lease.id, 'active', this.now().toISOString()) ?? lease
    return { ok: true, run, workspace: bindingFromLease(active), lease: active, replayed: reserved.replayed }
  }

  async releaseFork(leaseId: string, projectRoot: string, confirmed: boolean): Promise<WorkspaceFacadeResult> {
    const lease = this.deps.store.getLease(leaseId)
    if (lease === null) return { ok: false, reason: 'lease_not_found' }
    const run = this.deps.store.getRun(lease.runId)
    if (run === null) return { ok: false, reason: 'not_found' }
    if (lease.status === 'released') {
      return { ok: true, run, workspace: bindingFromLease(lease), lease, replayed: true }
    }
    const existing = this.deps.git
      .listWorktrees(projectRoot)
      .find((entry) => sameFsPath(entry.path, lease.canonicalWorkspacePath))
    if (existing && existing.branch !== lease.branch) return { ok: false, reason: 'foreign_workspace' }
    const dirty = existing ? this.deps.git.readWorktreeStatus(lease.worktreePath).dirty : false
    if (dirty && !confirmed) {
      const preserved = this.deps.store.updateLeaseStatus(lease.id, 'preserved', this.now().toISOString()) ?? lease
      return { ok: true, run, workspace: bindingFromLease(preserved), lease: preserved, replayed: true }
    }
    if (existing) {
      this.deps.git.removeWorktree({ repoRoot: projectRoot, worktreePath: lease.worktreePath, force: true })
      this.deps.git.deleteBranch(projectRoot, lease.branch, true)
    }
    await this.deps.reconcile?.(projectRoot)
    const released =
      this.deps.store.updateLeaseStatus(lease.id, 'released', this.now().toISOString(), this.now().toISOString()) ??
      lease
    return { ok: true, run, workspace: bindingFromLease(released), lease: released, replayed: !existing }
  }
}
