'use client'

// Everything that can be done to a worktree, from wherever it is offered.
//
// The same action is reachable from the sidebar row, the header, a keyboard
// shortcut and a Run's page, so the confirmations, the dialogs and the
// in-flight state live here once. Pages call the actions; the provider owns
// the dialogs and invalidates the queries each action makes stale.

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { APP_DEFAULTS } from 'portta-core/taskflow/config'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useToast } from '@/components/ui/toast'
import { usePreferences } from '../../lib/preferences.tsx'
import { useTaskflowCan, useTaskflowProject } from '../../lib/project.tsx'
import { useConfig } from '../../lib/queries/config.ts'
import { useRunWorkspaceContext, useWorkflows } from '../../lib/queries/runs.ts'
import { useAvailableBranches, useBaseBranches, useWorktrees } from '../../lib/queries/worktrees.ts'
import type { CreateRunRequest, CreateWorktreeRequest, LinearIssue, WorktreeInfo } from '../../lib/types.ts'
import { useIdle } from '../../lib/use-idle.ts'
import { errorMessage } from '../../lib/utils.ts'
import { LinearDetailDialog } from '../integrations/linear-detail-dialog.tsx'
import { LinearPostDialog } from '../integrations/linear-post-dialog.tsx'
import { useSidebarState } from '../shell/sidebar-state.tsx'
import { CreateWorktreeDialog } from './create-worktree-dialog.tsx'
import { WorktreeLabelDialog } from './worktree-label-dialog.tsx'
import { WorktreeProfileDialog } from './worktree-profile-dialog.tsx'
import { useWorktreeSelection } from './worktree-selection.tsx'

const DEFAULT_POLL_INTERVAL_MS = 5000
const ACTIVE_CREATE_POLL_INTERVAL_MS = 1000
const IDLE_AFTER_MS = 60_000

interface CreateDialogState {
  issue: LinearIssue | null
  workflowId: string | null
  lockedBaseBranch: string | null
}

interface PullState {
  /** The linked repository's alias, or null for the project's main branch. */
  repo: string | null
  force: boolean
  loading: boolean
  error: string
}

/** Which kinds of action this person may take on this Project; the proxy refuses the rest anyway. */
export interface WorktreeAllowed {
  write: boolean
  remove: boolean
  merge: boolean
  terminal: boolean
  runCreate: boolean
  linearWrite: boolean
}

export interface WorktreeActions {
  allowed: WorktreeAllowed
  removing: ReadonlySet<string>
  opening: ReadonlySet<string>
  archiving: ReadonlySet<string>
  postingLinear: ReadonlySet<string>
  refreshingAgentTerminal: ReadonlySet<string>
  activeCreateCount: number
  terminalSessionRevision: (branch: string) => number
  refresh: () => Promise<void>
  openCreate: (issue?: LinearIssue | null, workflowId?: string | null) => void
  openSubworktree: (parentBranch: string) => void
  requestRemove: (branch: string) => void
  requestMerge: (branch: string) => void
  close: (branch: string) => void
  toggleArchived: (branch: string) => void
  open: (branch: string) => void
  editLabel: (branch: string) => void
  editProfile: (branch: string) => void
  requestPull: (repo: string | null) => void
  postToLinear: (branch: string) => void
  showLinearIssue: (issue: LinearIssue) => void
  refreshAgentTerminal: (branch: string) => void
  syncPrs: (branch: string) => void
  copyNativeTerminalCommand: (branch: string) => void
  openRunSession: (branch: string) => void
  switchInterface: (enabled: boolean) => void
  /** Whether a dialog that owns the keyboard is open, so shortcuts stand down. */
  dialogOpen: boolean
}

type FailureKey =
  | 'createFailed'
  | 'createRunFailed'
  | 'removeFailed'
  | 'mergeFailed'
  | 'closeFailed'
  | 'archiveFailed'
  | 'restoreFailed'
  | 'openFailed'
  | 'postToLinearFailed'
  | 'refreshTerminalFailed'
  | 'switchInterfaceFailed'
  | 'syncPrsFailed'
  | 'nativeTerminalFailed'

const WorktreeActionsContext = createContext<WorktreeActions | null>(null)

function withBranch(branches: ReadonlySet<string>, branch: string): Set<string> {
  return new Set([...branches, branch])
}

function withoutBranch(branches: ReadonlySet<string>, branch: string): Set<string> {
  return new Set([...branches].filter((candidate) => candidate !== branch))
}

export function WorktreeActionsProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'actions' })
  const queryClient = useQueryClient()
  const router = useRouter()
  const { api, keys, paths } = useTaskflowProject()
  const canWrite = useTaskflowCan('worktree:write')
  const canRemove = useTaskflowCan('worktree:remove')
  const canMerge = useTaskflowCan('worktree:merge')
  const canTerminal = useTaskflowCan('terminal:attach')
  const canCreateRun = useTaskflowCan('run:create')
  const canWriteLinear = useTaskflowCan('linear:write')
  const allowed = useMemo<WorktreeAllowed>(
    () => ({
      write: canWrite,
      remove: canRemove,
      merge: canMerge,
      terminal: canTerminal,
      runCreate: canCreateRun,
      linearWrite: canWriteLinear,
    }),
    [canCreateRun, canMerge, canRemove, canTerminal, canWrite, canWriteLinear],
  )
  const toast = useToast()
  const config = useConfig()
  const { useWebChatUi, setUseWebChatUi } = usePreferences()
  const { closeOnMobile } = useSidebarState()
  const selection = useWorktreeSelection()
  const { worktrees, selectedBranch, selectedWorktree, visibleRows, reveal, navigateTo } = selection

  const [pendingCreateCount, setPendingCreateCount] = useState(0)
  const [pendingCreateBranchHint, setPendingCreateBranchHint] = useState<string | null>(null)
  const latestAutoSelectCreateIdRef = useRef(-1)
  const nextCreateRequestIdRef = useRef(0)
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set())
  const [opening, setOpening] = useState<ReadonlySet<string>>(new Set())
  const [archiving, setArchiving] = useState<ReadonlySet<string>>(new Set())
  const [postingLinear, setPostingLinear] = useState<ReadonlySet<string>>(new Set())
  const [refreshingAgentTerminal, setRefreshingAgentTerminal] = useState<ReadonlySet<string>>(new Set())
  const [terminalSessionRevisions, setTerminalSessionRevisions] = useState<Record<string, number>>({})

  const [createDialog, setCreateDialog] = useState<CreateDialogState | null>(null)
  const [includeRemoteBranches, setIncludeRemoteBranches] = useState(false)
  const [removeBranch, setRemoveBranch] = useState<string | null>(null)
  const [mergeBranch, setMergeBranch] = useState<string | null>(null)
  const [labelBranch, setLabelBranch] = useState<string | null>(null)
  const [labelLoading, setLabelLoading] = useState(false)
  const [labelError, setLabelError] = useState('')
  const [profileBranch, setProfileBranch] = useState<string | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [pull, setPull] = useState<PullState | null>(null)
  const [postToLinearBranch, setPostToLinearBranch] = useState<string | null>(null)
  const [postToLinkedConfirm, setPostToLinkedConfirm] = useState<{ branch: string; issueId: string } | null>(null)
  const [detailIssue, setDetailIssue] = useState<LinearIssue | null>(null)

  const creatingWorktrees = useMemo(() => worktrees.filter((worktree) => worktree.creating), [worktrees])
  // Removing a worktree deletes its branch, so name what only lives there
  // before asking, rather than after the host has refused the removal.
  const removeUnsaved = useMemo((): string | null => {
    const worktree = worktrees.find((entry) => entry.branch === removeBranch)
    if (!worktree) return null
    if (worktree.dirty) return t('remove.unsavedChanges')
    if (worktree.unpushed) return t('remove.unsavedCommits')
    return null
  }, [removeBranch, t, worktrees])
  const activeCreateCount = Math.max(pendingCreateCount, creatingWorktrees.length)
  const idle = useIdle(IDLE_AFTER_MS)
  // The one observer that polls; every other `useWorktrees()` reads the same cache.
  useWorktrees(idle ? false : activeCreateCount > 0 ? ACTIVE_CREATE_POLL_INTERVAL_MS : DEFAULT_POLL_INTERVAL_MS)
  const createOpen = createDialog !== null
  const workflows = useWorkflows(createOpen)
  const workspaceContext = useRunWorkspaceContext(createOpen)
  const availableBranches = useAvailableBranches(includeRemoteBranches, createOpen)
  const baseBranches = useBaseBranches(createOpen)
  const mainBranch = config.mainBranch || APP_DEFAULTS.mainBranch

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: keys.worktrees() }), [keys, queryClient])

  const wasIdle = useRef(idle)
  useEffect(() => {
    if (wasIdle.current && !idle) void refresh()
    wasIdle.current = idle
  }, [idle, refresh])

  useEffect(() => {
    if (workflows.error)
      toast.push({ tone: 'danger', title: t('loadWorkflowsFailed', { error: errorMessage(workflows.error) }) })
  }, [t, toast, workflows.error])

  useEffect(() => {
    if (workspaceContext.error)
      toast.push({ tone: 'danger', title: t('inspectCheckoutFailed', { error: errorMessage(workspaceContext.error) }) })
  }, [t, toast, workspaceContext.error])

  const failed = useCallback(
    (key: FailureKey, error: unknown): void => {
      toast.push({ tone: 'danger', title: t(key, { error: errorMessage(error) }) })
    },
    [t, toast],
  )

  function invalidateBranchCaches(): void {
    void queryClient.invalidateQueries({ queryKey: keys.branches() })
  }

  const selectNeighborOf = useCallback(
    (branch: string): void => {
      if (selectedBranch !== branch) return
      const ordered = visibleRows.map((row) => row.worktree)
      const index = ordered.findIndex((worktree) => worktree.branch === branch)
      const neighbor = [ordered[index - 1], ordered[index + 1]].find(
        (candidate) => candidate && !removing.has(candidate.branch),
      )
      navigateTo(neighbor?.branch ?? null, { replace: true })
    },
    [navigateTo, removing, selectedBranch, visibleRows],
  )

  useEffect(() => {
    const branches = new Set(worktrees.map((worktree) => worktree.branch))
    setTerminalSessionRevisions((revisions) => {
      const entries = Object.entries(revisions).filter(([branch]) => branches.has(branch))
      return entries.length === Object.keys(revisions).length ? revisions : Object.fromEntries(entries)
    })
  }, [worktrees])

  useEffect(() => {
    if (pendingCreateCount === 0 || latestAutoSelectCreateIdRef.current === -1) return
    const target = pendingCreateBranchHint
      ? worktrees.find((worktree) => worktree.branch === pendingCreateBranchHint)
      : creatingWorktrees.length === 1
        ? creatingWorktrees[0]
        : undefined
    if (!target || target.branch === selectedBranch) return
    reveal(target.branch)
    navigateTo(target.branch)
    closeOnMobile()
  }, [
    closeOnMobile,
    creatingWorktrees,
    navigateTo,
    pendingCreateBranchHint,
    pendingCreateCount,
    reveal,
    selectedBranch,
    worktrees,
  ])

  const openCreate = useCallback((issue: LinearIssue | null = null, workflowId: string | null = null): void => {
    setIncludeRemoteBranches(false)
    setCreateDialog({ issue, workflowId, lockedBaseBranch: null })
  }, [])

  const openSubworktree = useCallback((parentBranch: string): void => {
    setIncludeRemoteBranches(false)
    setCreateDialog({ issue: null, workflowId: null, lockedBaseBranch: parentBranch })
  }, [])

  async function handleCreate(request: CreateWorktreeRequest): Promise<void> {
    const requestId = nextCreateRequestIdRef.current++
    const shouldAutoSelect = selectedWorktree === undefined
    const requestedAgentIds = request.agents?.length
      ? request.agents
      : request.agent
        ? [request.agent]
        : [config.defaultAgentId]
    const expectedCreatedCount = requestedAgentIds.length
    const assignIssue = createDialog?.issue ?? null
    if (shouldAutoSelect) latestAutoSelectCreateIdRef.current = requestId
    setPendingCreateCount((count) => count + expectedCreatedCount)
    if (shouldAutoSelect) setPendingCreateBranchHint(expectedCreatedCount > 1 ? null : (request.branch ?? null))
    const withInterfaceMode: CreateWorktreeRequest = {
      ...request,
      interfaceMode: useWebChatUi ? 'web_chat' : 'terminal',
    }
    const finalRequest: CreateWorktreeRequest = assignIssue
      ? { ...withInterfaceMode, fromLinear: { issueId: assignIssue.identifier } }
      : withInterfaceMode
    setCreateDialog(null)
    try {
      const createPromise = api.createWorktree(finalRequest)
      void refresh()
      const result = await createPromise
      if (shouldAutoSelect) setPendingCreateBranchHint(result.primaryBranch)
      invalidateBranchCaches()
      await refresh()
      if (request.createLinearTicket) void queryClient.invalidateQueries({ queryKey: keys.linearIssues() })
      if (shouldAutoSelect && requestId === latestAutoSelectCreateIdRef.current) {
        navigateTo(result.primaryBranch)
        closeOnMobile()
      }
    } catch (error) {
      failed('createFailed', error)
    } finally {
      setPendingCreateCount((count) => Math.max(0, count - expectedCreatedCount))
      if (shouldAutoSelect && requestId === latestAutoSelectCreateIdRef.current) {
        setPendingCreateBranchHint(null)
        latestAutoSelectCreateIdRef.current = -1
      }
    }
  }

  async function handleRunCreate(request: CreateRunRequest): Promise<void> {
    try {
      const detail = await api.createRun(request)
      await queryClient.invalidateQueries({ queryKey: keys.runs() })
      setCreateDialog(null)
      router.push(paths.run(detail.run.id))
      toast.push({ tone: 'ok', title: t('runCreated') })
    } catch (error) {
      failed('createRunFailed', error)
    }
  }

  async function removeOrMerge(branch: string, kind: 'remove' | 'merge', force = false): Promise<void> {
    selectNeighborOf(branch)
    setRemoving((branches) => withBranch(branches, branch))
    try {
      if (kind === 'remove') await api.removeWorktree(branch, force)
      else await api.mergeWorktree(branch)
      invalidateBranchCaches()
      await refresh()
    } catch (error) {
      failed(kind === 'remove' ? 'removeFailed' : 'mergeFailed', error)
    } finally {
      setRemoving((branches) => withoutBranch(branches, branch))
    }
  }

  const close = useCallback(
    (branch: string): void => {
      selectNeighborOf(branch)
      void api
        .closeWorktree(branch)
        .then(() => refresh())
        .catch((error: unknown) => failed('closeFailed', error))
    },
    [api, failed, refresh, selectNeighborOf],
  )

  const toggleArchived = useCallback(
    (branch: string): void => {
      const worktree = worktrees.find((candidate) => candidate.branch === branch)
      if (!worktree || worktree.creating) return
      const archived = !worktree.archived
      setArchiving((branches) => withBranch(branches, branch))
      void api
        .setWorktreeArchived(branch, archived)
        .then(() => refresh())
        .catch((error: unknown) => failed(archived ? 'archiveFailed' : 'restoreFailed', error))
        .finally(() => setArchiving((branches) => withoutBranch(branches, branch)))
    },
    [api, failed, refresh, worktrees],
  )

  const open = useCallback(
    (branch: string): void => {
      setOpening((branches) => withBranch(branches, branch))
      void api
        .openWorktree(branch, useWebChatUi ? 'web_chat' : 'terminal')
        .then(() => refresh())
        .catch((error: unknown) => failed('openFailed', error))
        .finally(() => setOpening((branches) => withoutBranch(branches, branch)))
    },
    [api, failed, refresh, useWebChatUi],
  )

  const openRunSession = useCallback(
    (branch: string): void => {
      reveal(branch)
      navigateTo(branch)
      const worktree = worktrees.find((candidate) => candidate.branch === branch)
      if (worktree && worktree.mux !== '✓' && !worktree.creating) open(branch)
      closeOnMobile()
    },
    [closeOnMobile, navigateTo, open, reveal, worktrees],
  )

  async function handleLabelChange(label: string | null): Promise<void> {
    if (!labelBranch) return
    const branch = labelBranch
    setLabelLoading(true)
    setLabelError('')
    try {
      const nextLabel = await api.setWorktreeLabel(branch, label)
      queryClient.setQueryData<WorktreeInfo[]>(keys.worktrees(), (items) =>
        items?.map((worktree) => (worktree.branch === branch ? { ...worktree, label: nextLabel } : worktree)),
      )
      setLabelBranch(null)
    } catch (error) {
      setLabelError(errorMessage(error))
    } finally {
      setLabelLoading(false)
    }
  }

  const bumpTerminalSession = useCallback((branch: string): void => {
    setTerminalSessionRevisions((revisions) => ({ ...revisions, [branch]: (revisions[branch] ?? 0) + 1 }))
  }, [])

  async function handleProfileChange(profile: string): Promise<void> {
    if (!profileBranch) return
    const branch = profileBranch
    setProfileLoading(true)
    setProfileError('')
    try {
      const result = await api.setWorktreeProfile(branch, profile)
      setProfileBranch(null)
      await refresh()
      if (result.restarted) bumpTerminalSession(branch)
      toast.push({
        tone: 'ok',
        title: result.restarted
          ? t('profileSwitched', { branch, profile: result.profile })
          : t('profileSwitchedNextOpen', { branch, profile: result.profile }),
      })
    } catch (error) {
      setProfileError(errorMessage(error))
    } finally {
      setProfileLoading(false)
    }
  }

  async function handlePull(): Promise<void> {
    if (!pull) return
    const { repo, force } = pull
    setPull({ ...pull, loading: true, error: '' })
    try {
      const result = await api.pullMain({ ...(force ? { force: true } : {}), ...(repo ? { repo } : {}) })
      if (result.status === 'updated' || result.status === 'already_up_to_date') {
        setPull(null)
        if (!repo)
          toast.push({
            tone: result.status === 'updated' ? 'ok' : 'neutral',
            title:
              result.status === 'updated'
                ? t('pull.updated', { branch: mainBranch })
                : t('pull.upToDate', { branch: mainBranch }),
          })
      } else if (result.status === 'merge_failed' && !force) {
        setPull({
          repo,
          force: true,
          loading: false,
          error: t(repo ? 'pull.fastForwardFailedRepo' : 'pull.fastForwardFailed', {
            error: result.error ?? t('pull.unknownError'),
          }),
        })
      } else setPull({ repo, force, loading: false, error: result.error ?? result.status })
    } catch (error) {
      setPull({ repo, force, loading: false, error: errorMessage(error) })
    }
  }

  const postToLinear = useCallback(
    (branch: string): void => {
      if (postingLinear.has(branch)) return
      const worktree = worktrees.find((candidate) => candidate.branch === branch)
      if (!worktree?.linearIssue) {
        setPostToLinearBranch(branch)
        return
      }
      setPostToLinkedConfirm({ branch, issueId: worktree.linearIssue.identifier })
    },
    [postingLinear, worktrees],
  )

  async function confirmPostToLinkedIssue(): Promise<void> {
    if (!postToLinkedConfirm) return
    const { branch, issueId } = postToLinkedConfirm
    setPostToLinkedConfirm(null)
    setPostingLinear((branches) => withBranch(branches, branch))
    try {
      const response = await api.postWorktreeToLinear(branch, { kind: 'issue', issueId })
      toast.push({ tone: 'ok', title: t('postedToLinear', { url: response.issueUrl }) })
    } catch (error) {
      failed('postToLinearFailed', error)
    } finally {
      setPostingLinear((branches) => withoutBranch(branches, branch))
    }
  }

  const refreshAgentTerminal = useCallback(
    (branch: string): void => {
      if (refreshingAgentTerminal.has(branch)) return
      setRefreshingAgentTerminal((branches) => withBranch(branches, branch))
      void api
        .refreshWorktreeAgentTerminal(branch)
        .then(async () => {
          await refresh()
          bumpTerminalSession(branch)
          toast.push({ tone: 'ok', title: t('terminalRefreshed') })
        })
        .catch((error: unknown) => failed('refreshTerminalFailed', error))
        .finally(() => setRefreshingAgentTerminal((branches) => withoutBranch(branches, branch)))
    },
    [api, bumpTerminalSession, failed, refresh, refreshingAgentTerminal, t, toast],
  )

  const syncPrs = useCallback(
    (branch: string): void => {
      void api
        .syncWorktreePrs(branch)
        .then(async () => {
          await refresh()
          toast.push({ tone: 'ok', title: t('prsSynced', { branch }) })
        })
        .catch((error: unknown) => failed('syncPrsFailed', error))
    },
    [api, failed, refresh, t, toast],
  )

  const copyNativeTerminalCommand = useCallback(
    (branch: string): void => {
      void api
        .fetchNativeTerminalLaunch(branch)
        .then(async (launch) => {
          await navigator.clipboard.writeText(launch.shellCommand)
          toast.push({ tone: 'ok', title: t('nativeTerminalCopied'), description: launch.shellCommand })
        })
        .catch((error: unknown) => failed('nativeTerminalFailed', error))
    },
    [api, failed, t, toast],
  )

  const switchInterface = useCallback(
    (enabled: boolean): void => {
      setUseWebChatUi(enabled)
      const branch = selectedWorktree?.branch
      if (!branch || selectedWorktree.mux !== '✓') return
      setOpening((branches) => withBranch(branches, branch))
      void (async (): Promise<void> => {
        try {
          await api.closeWorktree(branch)
          await api.openWorktree(branch, enabled ? 'web_chat' : 'terminal')
          await refresh()
        } catch (error) {
          failed('switchInterfaceFailed', error)
        } finally {
          setOpening((branches) => withoutBranch(branches, branch))
        }
      })()
    },
    [api, failed, refresh, selectedWorktree, setUseWebChatUi],
  )

  const terminalSessionRevision = useCallback(
    (branch: string): number => terminalSessionRevisions[branch] ?? 0,
    [terminalSessionRevisions],
  )

  const dialogOpen =
    createOpen || removeBranch !== null || mergeBranch !== null || pull !== null || postToLinkedConfirm !== null

  const value = useMemo<WorktreeActions>(
    () => ({
      allowed,
      removing,
      opening,
      archiving,
      postingLinear,
      refreshingAgentTerminal,
      activeCreateCount,
      terminalSessionRevision,
      refresh,
      openCreate,
      openSubworktree,
      requestRemove: setRemoveBranch,
      requestMerge: setMergeBranch,
      close,
      toggleArchived,
      open,
      editLabel: (branch) => {
        setLabelBranch(branch)
        setLabelError('')
      },
      editProfile: (branch) => {
        setProfileBranch(branch)
        setProfileError('')
      },
      requestPull: (repo) => setPull({ repo, force: false, loading: false, error: '' }),
      postToLinear,
      showLinearIssue: setDetailIssue,
      refreshAgentTerminal,
      syncPrs,
      copyNativeTerminalCommand,
      openRunSession,
      switchInterface,
      dialogOpen,
    }),
    [
      activeCreateCount,
      allowed,
      copyNativeTerminalCommand,
      archiving,
      close,
      dialogOpen,
      open,
      openCreate,
      openRunSession,
      openSubworktree,
      opening,
      postToLinear,
      postingLinear,
      refresh,
      refreshAgentTerminal,
      refreshingAgentTerminal,
      removing,
      switchInterface,
      syncPrs,
      terminalSessionRevision,
      toggleArchived,
    ],
  )

  const labelWorktree = labelBranch ? worktrees.find((worktree) => worktree.branch === labelBranch) : undefined
  const profileWorktree = profileBranch ? worktrees.find((worktree) => worktree.branch === profileBranch) : undefined
  const assignIssue = createDialog?.issue ?? null

  return (
    <WorktreeActionsContext.Provider value={value}>
      {children}
      {createDialog ? (
        <CreateWorktreeDialog
          profiles={config.profiles}
          agents={config.agents}
          defaultProfileName={config.defaultProfileName}
          defaultAgentId={config.defaultAgentId}
          autoNameEnabled={config.autoName}
          initialBranch={assignIssue?.branchName ?? ''}
          initialPrompt={
            assignIssue ? `${assignIssue.title}${assignIssue.description ? `\n\n${assignIssue.description}` : ''}` : ''
          }
          includeRemoteBranches={includeRemoteBranches}
          onIncludeRemoteBranchesChange={setIncludeRemoteBranches}
          availableBranches={availableBranches.data ?? []}
          availableBranchesLoading={availableBranches.isFetching}
          availableBranchesError={availableBranches.error ? errorMessage(availableBranches.error) : null}
          baseBranches={baseBranches.data ?? []}
          baseBranchesLoading={baseBranches.isFetching}
          baseBranchesError={baseBranches.error ? errorMessage(baseBranches.error) : null}
          lockedBaseBranch={createDialog.lockedBaseBranch}
          startupEnvs={config.startupEnvs ?? {}}
          linearCreateTicketOption={config.linearCreateTicketOption}
          openedFromLinearIssue={assignIssue !== null}
          workflows={workflows.data ?? []}
          workflowsLoading={workflows.isFetching}
          initialWorkflowId={createDialog.workflowId}
          workspaceContext={workspaceContext.data ?? null}
          onCreate={(request) => {
            void handleCreate(request)
          }}
          onRunCreate={(request) => {
            void handleRunCreate(request)
          }}
          onCancel={() => setCreateDialog(null)}
        />
      ) : null}
      {labelBranch && labelWorktree ? (
        <WorktreeLabelDialog
          branch={labelWorktree.branch}
          initialLabel={labelWorktree.label}
          loading={labelLoading}
          error={labelError}
          onConfirm={(label) => {
            void handleLabelChange(label)
          }}
          onClear={() => {
            void handleLabelChange(null)
          }}
          onCancel={() => {
            setLabelBranch(null)
            setLabelError('')
          }}
        />
      ) : null}
      {profileBranch && profileWorktree ? (
        <WorktreeProfileDialog
          branch={profileWorktree.branch}
          profiles={config.profiles}
          currentProfile={profileWorktree.profile}
          isOpen={profileWorktree.mux === '✓'}
          loading={profileLoading}
          error={profileError}
          onConfirm={(profile) => {
            void handleProfileChange(profile)
          }}
          onCancel={() => {
            setProfileBranch(null)
            setProfileError('')
          }}
        />
      ) : null}
      <ConfirmDialog
        open={removeBranch !== null}
        onOpenChange={(next) => {
          if (!next) setRemoveBranch(null)
        }}
        title={t('remove.title')}
        impact={
          removeUnsaved
            ? t('remove.unsavedImpact', { branch: removeBranch ?? '', work: removeUnsaved })
            : t('remove.impact', { branch: removeBranch ?? '' })
        }
        confirmLabel={removeUnsaved ? t('remove.unsavedConfirm') : t('remove.confirm')}
        onConfirm={() => {
          const branch = removeBranch
          setRemoveBranch(null)
          // Removing deletes the branch, so the host refuses to discard work
          // unless it is asked to. The dialog above is that asking.
          if (branch) void removeOrMerge(branch, 'remove', removeUnsaved !== null)
        }}
      />
      <ConfirmDialog
        open={mergeBranch !== null}
        onOpenChange={(next) => {
          if (!next) setMergeBranch(null)
        }}
        title={t('merge.title')}
        impact={t('merge.impact', { branch: mergeBranch ?? '' })}
        confirmLabel={t('merge.confirm')}
        tone="default"
        onConfirm={() => {
          const branch = mergeBranch
          setMergeBranch(null)
          if (branch) void removeOrMerge(branch, 'merge')
        }}
      />
      {pull ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setPull(null)
          }}
          title={pull.repo ? t('pull.repoTitle', { repo: pull.repo }) : t('pull.title', { branch: mainBranch })}
          impact={
            pull.repo
              ? pull.force
                ? t('pull.forceRepoImpact', { repo: pull.repo })
                : t('pull.repoImpact', { repo: pull.repo })
              : pull.force
                ? t('pull.forceImpact', { branch: mainBranch, defaultBranch: APP_DEFAULTS.mainBranch })
                : t('pull.impact', { branch: mainBranch })
          }
          confirmLabel={pull.force ? t('pull.forceConfirm') : t('pull.confirm')}
          tone={pull.force ? 'danger' : 'default'}
          busy={pull.loading}
          error={pull.error || undefined}
          onConfirm={() => {
            void handlePull()
          }}
        />
      ) : null}
      {detailIssue ? (
        <LinearDetailDialog
          issue={detailIssue}
          onAssign={(issue) => {
            setDetailIssue(null)
            openCreate(issue)
          }}
          onClose={() => setDetailIssue(null)}
        />
      ) : null}
      {postToLinearBranch ? (
        <LinearPostDialog
          branch={postToLinearBranch}
          onSubmit={async (target) => {
            const response = await api.postWorktreeToLinear(postToLinearBranch, target)
            toast.push({ tone: 'ok', title: t('postedToLinear', { url: response.issueUrl }) })
          }}
          onClose={() => setPostToLinearBranch(null)}
        />
      ) : null}
      <ConfirmDialog
        open={postToLinkedConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setPostToLinkedConfirm(null)
        }}
        title={t('postLinked.title')}
        impact={t('postLinked.impact', { issue: postToLinkedConfirm?.issueId ?? '' })}
        confirmLabel={t('postLinked.confirm')}
        tone="default"
        onConfirm={() => {
          void confirmPostToLinkedIssue()
        }}
      />
    </WorktreeActionsContext.Provider>
  )
}

export function useWorktreeActions(): WorktreeActions {
  const value = useContext(WorktreeActionsContext)
  if (!value) throw new Error('WorktreeActionsProvider is not mounted')
  return value
}
