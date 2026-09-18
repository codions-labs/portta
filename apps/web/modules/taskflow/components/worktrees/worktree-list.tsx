'use client'

import {
  Archive,
  ArchiveRestore,
  CornerDownRight,
  GitBranchPlus,
  GitMerge,
  Loader2,
  MoreVertical,
  Send,
  SlidersHorizontal,
  SquareX,
  Trash2,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { iconButton } from '@/components/ui/surfaces'
import { useWorktreeCreationPhaseLabel } from '../../lib/phase-labels.ts'
import type { WorktreeListRow } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import {
  branchesWithAgentStatus,
  countAgentStatusesIn,
  OVERFLOW_STATUS_BAR_STATUSES,
  type OverflowStatusBarStatus,
} from '../../lib/worktree-list.ts'
import { LinearBadge } from '../integrations/linear-badge.tsx'
import { AgentStatusIcon, agentIconVisible } from './agent-status-icon.tsx'
import { PrBadge } from './pr-badge.tsx'

type RowPosition = 'above' | 'visible' | 'below'
type Direction = 'above' | 'below'

interface WorktreeListProps {
  rows: WorktreeListRow[]
  selected: string | null
  removing: ReadonlySet<string>
  initializing: ReadonlySet<string>
  archiving: ReadonlySet<string>
  postingLinear: ReadonlySet<string>
  notifiedBranches: ReadonlySet<string>
  emptyMessage?: string
  onSelect: (branch: string) => void
  /** Each row action shows only when its handler is given: a person without the permission is not offered it. */
  onClose?: (branch: string) => void
  onArchive?: (branch: string) => void
  onMerge?: (branch: string) => void
  onRemove?: (branch: string) => void
  onEditProfile?: (branch: string) => void
  onCreateSubworktree?: (branch: string) => void
  onPostToLinear?: (branch: string) => void
}

function StatusBar({
  counts,
  direction,
  onCycle,
}: {
  counts: Record<OverflowStatusBarStatus, number>
  direction: Direction
  onCycle: (status: OverflowStatusBarStatus, direction: Direction) => void
}) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'list' })
  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-overlay px-1.5 py-1 shadow-overlay">
      {OVERFLOW_STATUS_BAR_STATUSES.map((status) =>
        counts[status] > 0 ? (
          <button
            type="button"
            className="flex cursor-pointer items-center gap-1 rounded-full px-1.5 py-0.5 text-2xs tabular-nums hover:bg-fill focus-ring"
            title={t(`scrollTo.${direction}.${status}`)}
            onClick={() => onCycle(status, direction)}
            key={status}
          >
            <AgentStatusIcon
              status={status === 'done-unread' ? 'done' : status}
              unread={status === 'done-unread'}
              size={12}
            />
            <span>{counts[status]}</span>
          </button>
        ) : null,
      )}
    </div>
  )
}

function branchesAt(rowPositions: Map<string, RowPosition>, position: RowPosition): Set<string> {
  const branches = new Set<string>()
  for (const [branch, value] of rowPositions) if (value === position) branches.add(branch)
  return branches
}

export function WorktreeList(props: WorktreeListProps) {
  const {
    rows,
    selected,
    removing,
    initializing,
    archiving,
    postingLinear,
    notifiedBranches,
    emptyMessage,
    onSelect,
    onClose,
    onArchive,
    onMerge,
    onRemove,
    onEditProfile,
    onCreateSubworktree,
    onPostToLinear,
  } = props
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'list' })
  const { t: tc } = useTranslation('common')
  const phaseLabel = useWorktreeCreationPhaseLabel()
  const [rowPositions, setRowPositions] = useState<Map<string, RowPosition>>(new Map())
  const [cycleCursor, setCycleCursor] = useState<Record<string, string>>({})
  const [topBarHeight, setTopBarHeight] = useState(0)
  const [bottomBarHeight, setBottomBarHeight] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const topBarRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  const rootMargin = `-${topBarHeight ? topBarHeight + 8 : 0}px 0px -${bottomBarHeight ? bottomBarHeight + 8 : 0}px 0px`

  useLayoutEffect(() => {
    setTopBarHeight(topBarRef.current?.offsetHeight ?? 0)
    setBottomBarHeight(bottomBarRef.current?.offsetHeight ?? 0)
  })

  useEffect(() => {
    const root = listRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const present = new Set(rows.map((row) => row.worktree.branch))
    setRowPositions((current) => new Map([...current].filter(([branch]) => present.has(branch))))
    const observer = new IntersectionObserver(
      (entries) => {
        setRowPositions((current) => {
          const next = new Map(current)
          for (const entry of entries) {
            if (!(entry.target instanceof HTMLElement)) continue
            const branch = entry.target.dataset.branch
            if (!branch) continue
            if (entry.isIntersecting) next.set(branch, 'visible')
            else next.set(branch, entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0) ? 'above' : 'below')
          }
          return next
        })
      },
      { root, rootMargin, threshold: 0 },
    )
    for (const row of root.querySelectorAll('[data-branch]')) observer.observe(row)
    return () => observer.disconnect()
  }, [rootMargin, rows])

  const aboveBranches = branchesAt(rowPositions, 'above')
  const belowBranches = branchesAt(rowPositions, 'below')
  const aboveCounts = countAgentStatusesIn(rows, aboveBranches, notifiedBranches)
  const belowCounts = countAgentStatusesIn(rows, belowBranches, notifiedBranches)
  const hasAbove = OVERFLOW_STATUS_BAR_STATUSES.some((status) => aboveCounts[status] > 0)
  const hasBelow = OVERFLOW_STATUS_BAR_STATUSES.some((status) => belowCounts[status] > 0)

  function cycleToStatus(status: OverflowStatusBarStatus, direction: Direction): void {
    const branches = branchesWithAgentStatus(
      rows,
      status,
      direction === 'above' ? aboveBranches : belowBranches,
      notifiedBranches,
    )
    if (direction === 'above') branches.reverse()
    if (branches.length === 0 || !listRef.current) return
    const key = `${direction}:${status}`
    const nextBranch = branches[(branches.indexOf(cycleCursor[key] ?? '') + 1) % branches.length]
    if (nextBranch === undefined) return
    setCycleCursor((current) => ({ ...current, [key]: nextBranch }))
    const target = Array.from(listRef.current.querySelectorAll<HTMLElement>('[data-branch]')).find(
      (element) => element.dataset.branch === nextBranch,
    )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ul ref={listRef} className="min-h-0 flex-1 list-none overflow-y-auto p-2 scroll-thin">
        {rows.length === 0 ? (
          <li className="px-3 py-4 text-center text-xs text-subtle">{emptyMessage ?? t('empty')}</li>
        ) : null}
        {rows.map(({ worktree, depth }) => {
          const active = worktree.branch === selected
          const removingNow = removing.has(worktree.branch)
          const closed = worktree.mux !== '✓'
          const initializingNow = initializing.has(worktree.branch)
          const archivingNow = archiving.has(worktree.branch)
          const busy = removingNow || initializingNow
          const hasBadgeRow =
            worktree.archived ||
            worktree.creating ||
            initializingNow ||
            closed ||
            worktree.prs.length > 0 ||
            Boolean(worktree.linearIssue) ||
            worktree.source === 'oneshot'
          return (
            <li
              data-branch={worktree.branch}
              className={cn('group relative mb-0.5', busy && 'pointer-events-none opacity-40')}
              key={worktree.branch}
            >
              <button
                type="button"
                disabled={busy}
                className={cn(
                  'flex w-full cursor-pointer flex-col gap-1 rounded-md border py-2 text-left text-sm transition-colors duration-100 focus-ring',
                  active ? 'border-accent/40 bg-selection' : 'border-transparent hover:bg-fill',
                  closed && !initializingNow && !worktree.creating && 'opacity-50',
                  worktree.archived && 'opacity-70',
                )}
                style={{ paddingLeft: 12 + depth * 18, paddingRight: 40 }}
                onClick={() => onSelect(worktree.branch)}
              >
                <span className="flex min-w-0 items-start gap-2 pr-5">
                  {depth > 0 ? <CornerDownRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-faint" /> : null}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex min-w-0 items-center gap-1.5" data-worktree-name-row>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-medium text-ink">{worktree.label ?? worktree.branch}</span>
                        {worktree.label ? (
                          <span className="truncate text-2xs leading-tight text-subtle">{worktree.branch}</span>
                        ) : null}
                      </span>
                      {!worktree.creating &&
                      !initializingNow &&
                      !closed &&
                      agentIconVisible(worktree.agent, notifiedBranches.has(worktree.branch)) ? (
                        <span className="shrink-0">
                          <AgentStatusIcon
                            status={worktree.agent}
                            size={14}
                            unread={notifiedBranches.has(worktree.branch)}
                          />
                        </span>
                      ) : null}
                    </span>
                    {hasBadgeRow ? (
                      <span className="flex min-w-0 flex-wrap items-center gap-1.5" data-worktree-badge-row>
                        {worktree.source === 'oneshot' ? (
                          <Badge tone="outline" title={t('oneshotHint')}>
                            {t('oneshot')}
                          </Badge>
                        ) : null}
                        {worktree.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
                        {worktree.creating ? (
                          <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-subtle">
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                            {phaseLabel(worktree.creationPhase)}...
                          </span>
                        ) : initializingNow ? (
                          <span className="shrink-0 text-2xs text-subtle">{t('opening')}</span>
                        ) : closed ? (
                          <span className="shrink-0 text-2xs text-subtle">{t('closed')}</span>
                        ) : null}
                        {worktree.prs.map((pr) => (
                          <PrBadge pr={pr} key={pr.repo} />
                        ))}
                        {worktree.linearIssue ? <LinearBadge issue={worktree.linearIssue} /> : null}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-2xs text-subtle">
                  {(worktree.agentLabel ?? worktree.agentName) ? (
                    <span>{worktree.agentLabel ?? worktree.agentName}</span>
                  ) : null}
                  {worktree.profile ? <span>{worktree.profile}</span> : null}
                </span>
                {worktree.services.length > 0 ? (
                  <span className="flex gap-2 font-mono text-2xs text-subtle">
                    {worktree.services.map((service) =>
                      service.port ? (
                        <span className={service.running ? 'text-ok' : ''} key={service.name}>
                          {service.name}:{service.port}
                        </span>
                      ) : null,
                    )}
                  </span>
                ) : null}
              </button>
              {onClose || onArchive || onEditProfile || onMerge || onCreateSubworktree || onRemove || onPostToLinear ? (
                <Menu>
                  <MenuTrigger
                    disabled={busy}
                    className={cn(iconButton, 'row-actions absolute top-2 right-2 data-[state=open]:opacity-100')}
                    title={t('actionsTitle')}
                    aria-label={t('actionsFor', { branch: worktree.branch })}
                  >
                    <MoreVertical />
                  </MenuTrigger>
                  <MenuContent align="end">
                    {onClose ? (
                      <MenuItem
                        icon={<SquareX />}
                        disabled={closed || worktree.creating}
                        onSelect={() => onClose(worktree.branch)}
                      >
                        {tc('close')}
                      </MenuItem>
                    ) : null}
                    {onArchive ? (
                      <MenuItem
                        icon={worktree.archived ? <ArchiveRestore /> : <Archive />}
                        disabled={worktree.creating || archivingNow}
                        onSelect={() => onArchive(worktree.branch)}
                      >
                        {worktree.archived ? t('restore') : t('archive')}
                      </MenuItem>
                    ) : null}
                    {onEditProfile ? (
                      <MenuItem
                        icon={<SlidersHorizontal />}
                        disabled={worktree.creating}
                        onSelect={() => onEditProfile(worktree.branch)}
                      >
                        {t('changeProfile')}
                      </MenuItem>
                    ) : null}
                    {onMerge ? (
                      <MenuItem icon={<GitMerge />} onSelect={() => onMerge(worktree.branch)}>
                        {t('merge')}
                      </MenuItem>
                    ) : null}
                    {onCreateSubworktree ? (
                      <MenuItem
                        icon={<GitBranchPlus />}
                        disabled={worktree.creating}
                        onSelect={() => onCreateSubworktree(worktree.branch)}
                      >
                        {t('createSubworktree')}
                      </MenuItem>
                    ) : null}
                    {onRemove ? (
                      <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => onRemove(worktree.branch)}>
                        {tc('remove')}
                      </MenuItem>
                    ) : null}
                    {onPostToLinear ? (
                      <>
                        <MenuSeparator />
                        <MenuItem
                          icon={<Send />}
                          disabled={postingLinear.has(worktree.branch)}
                          onSelect={() => onPostToLinear(worktree.branch)}
                        >
                          {postingLinear.has(worktree.branch)
                            ? t('postingToLinear')
                            : worktree.linearIssue
                              ? t('postToIssue', { issue: worktree.linearIssue.identifier })
                              : t('postToLinear')}
                        </MenuItem>
                      </>
                    ) : null}
                  </MenuContent>
                </Menu>
              ) : null}
            </li>
          )
        })}
      </ul>
      {hasAbove ? (
        <div ref={topBarRef} className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
          <StatusBar counts={aboveCounts} direction="above" onCycle={cycleToStatus} />
        </div>
      ) : null}
      {hasBelow ? (
        <div ref={bottomBarRef} className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
          <StatusBar counts={belowCounts} direction="below" onCycle={cycleToStatus} />
        </div>
      ) : null}
    </div>
  )
}
