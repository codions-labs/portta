'use client'

import {
  Archive,
  ArchiveRestore,
  Bell,
  BookOpen,
  GitMerge,
  Menu as MenuIcon,
  MoreHorizontal,
  MoreVertical,
  Pencil,
  RefreshCw,
  Settings,
  SquareTerminal,
  SquareX,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { iconButton, overlayLabel } from '@/components/ui/surfaces'
import { Tooltip } from '@/components/ui/tooltip'
import { TASKFLOW_DOCS } from '../../lib/navigation.ts'
import type { AppNotification, LinkedRepoInfo, PrEntry, WorktreeInfo } from '../../lib/types.ts'
import { cn, makeCursorUrl } from '../../lib/utils.ts'
import { LinearBadge } from '../integrations/linear-badge.tsx'
import { RepoGroup } from '../worktrees/repo-group.tsx'
import type { WorktreeAllowed } from '../worktrees/worktree-actions.tsx'
import { NotificationItem } from './notification-item.tsx'

interface TopBarProps {
  name: string | null
  worktree: WorktreeInfo | undefined
  sshHost: string
  linkedRepos?: LinkedRepoInfo[]
  isMobile?: boolean
  notificationHistory?: AppNotification[]
  unreadCount?: number
  onToggleSidebar?: () => void
  onClose: () => void
  onArchive: () => void
  onMerge: () => void
  onRemove: () => void
  onEditLabel?: () => void
  onSyncPrs?: () => void
  onCopyTerminalCommand?: () => void
  /** What this person may do; everything is offered when absent. */
  allowed?: Partial<WorktreeAllowed>
  onSettings: () => void
  onCiClick: (pr: PrEntry) => void
  onReviewsClick: (pr: PrEntry) => void
  onDirtyClick?: () => void
  onBellOpen?: () => void
  onNotificationSelect?: (branch: string) => void
  archiving?: boolean
}

function truncateWorktreeName(value: string | null, maxLength: number): string | null {
  if (!value || value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

export function TopBar({
  name,
  worktree,
  sshHost,
  linkedRepos = [],
  isMobile = false,
  notificationHistory = [],
  unreadCount = 0,
  onToggleSidebar,
  onClose,
  onArchive,
  onMerge,
  onRemove,
  onEditLabel,
  onSyncPrs,
  onCopyTerminalCommand,
  allowed = {},
  onSettings,
  onCiClick,
  onReviewsClick,
  onDirtyClick,
  onBellOpen,
  onNotificationSelect,
  archiving = false,
}: TopBarProps) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'topBar' })
  const { t: tc } = useTranslation('common')
  const [bellOpen, setBellOpen] = useState(false)
  const cursorUrl = makeCursorUrl(worktree?.dir, sshHost)
  const headerName = worktree?.label ?? name
  const displayName = truncateWorktreeName(headerName, 30)
  const displayBranch = worktree?.label ? truncateWorktreeName(name, 44) : null
  const mainPrs = (worktree?.prs ?? []).filter(
    (pr) => !pr.repo || !linkedRepos.some((linkedRepo) => linkedRepo.alias === pr.repo),
  )
  const linkedRepoGroups = linkedRepos
    .map((linkedRepo) => ({
      alias: linkedRepo.alias,
      cursorUrl: makeCursorUrl(linkedRepo.dir && name ? `${linkedRepo.dir}/${name}` : null, sshHost),
      prs: (worktree?.prs ?? []).filter((pr) => pr.repo === linkedRepo.alias),
    }))
    .filter((group) => group.prs.length > 0 || group.cursorUrl)
  const hasMoreContent = mainPrs.length > 0 || linkedRepoGroups.length > 0
  const may = (kind: keyof WorktreeAllowed): boolean => allowed[kind] ?? true

  function handleBellOpenChange(open: boolean): void {
    if (open) onBellOpen?.()
    setBellOpen(open)
  }

  return (
    <div className="border-b border-line bg-surface">
      <div className="flex min-h-12 items-stretch">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-4 py-2.5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {isMobile && onToggleSidebar ? (
                <button
                  type="button"
                  className={cn(iconButton, '-ml-1 size-7')}
                  onClick={onToggleSidebar}
                  title={t('toggleSidebar')}
                  aria-label={t('toggleSidebar')}
                >
                  <MenuIcon />
                </button>
              ) : null}
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-sm font-semibold text-ink" title={headerName ?? undefined}>
                    {displayName ?? t('selectWorktree')}
                  </span>
                  {worktree && onEditLabel && may('write') ? (
                    <button
                      type="button"
                      className={iconButton}
                      title={t('editLabel')}
                      aria-label={t('editLabel')}
                      onClick={onEditLabel}
                    >
                      <Pencil />
                    </button>
                  ) : null}
                </span>
                {displayBranch ? (
                  <span className="truncate text-2xs text-subtle" title={name ?? undefined}>
                    {displayBranch}
                  </span>
                ) : null}
              </span>
              {worktree?.archived ? <Badge tone="outline">{t('archived')}</Badge> : null}
              {worktree?.dirty || worktree?.unpushed ? (
                <button
                  type="button"
                  className="inline-flex h-5 shrink-0 items-center rounded-sm bg-warn/14 px-1.5 text-2xs font-medium text-warn transition-colors hover:bg-warn/20 focus-ring"
                  onClick={onDirtyClick}
                >
                  {worktree.dirty ? t('dirty') : t('unpushed')}
                </button>
              ) : null}
              {worktree?.linearIssue ? <LinearBadge issue={worktree.linearIssue} clickable /> : null}
            </div>
            {!isMobile ? (
              <div className="min-w-0 flex-1">
                <RepoGroup
                  prs={mainPrs}
                  services={worktree?.services ?? []}
                  cursorUrl={cursorUrl}
                  onCiClick={onCiClick}
                  onReviewsClick={onReviewsClick}
                />
              </div>
            ) : null}
          </div>
          {!isMobile
            ? linkedRepoGroups.map((group) => (
                <RepoGroup
                  key={group.alias}
                  label={group.alias}
                  prs={group.prs}
                  cursorUrl={group.cursorUrl}
                  onCiClick={onCiClick}
                  onReviewsClick={onReviewsClick}
                />
              ))
            : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 px-4">
          {worktree ? (
            <>
              {worktree.mux === '✓' && may('write') ? (
                <Button
                  size={isMobile ? 'icon' : 'sm'}
                  onClick={onClose}
                  title={t('closeTitle')}
                  aria-label={isMobile ? tc('close') : undefined}
                >
                  {isMobile ? <SquareX /> : tc('close')}
                </Button>
              ) : null}
              {may('write') ? (
                <Button
                  size={isMobile ? 'icon' : 'sm'}
                  onClick={onArchive}
                  disabled={archiving || worktree.creating}
                  title={worktree.archived ? t('restoreTitle') : t('archiveTitle')}
                  aria-label={isMobile ? (worktree.archived ? t('restore') : t('archive')) : undefined}
                >
                  {isMobile ? (
                    worktree.archived ? (
                      <ArchiveRestore />
                    ) : (
                      <Archive />
                    )
                  ) : worktree.archived ? (
                    t('restore')
                  ) : (
                    t('archive')
                  )}
                </Button>
              ) : null}
              {may('merge') ? (
                <Button
                  size={isMobile ? 'icon' : 'sm'}
                  onClick={onMerge}
                  title={t('mergeTitle')}
                  aria-label={isMobile ? t('merge') : undefined}
                >
                  {isMobile ? <GitMerge /> : t('merge')}
                </Button>
              ) : null}
              {may('remove') ? (
                <Button
                  size={isMobile ? 'icon' : 'sm'}
                  variant="danger"
                  onClick={onRemove}
                  title={t('removeTitle')}
                  aria-label={isMobile ? tc('remove') : undefined}
                >
                  {isMobile ? <Trash2 /> : tc('remove')}
                </Button>
              ) : null}
              {(onSyncPrs && may('write')) || (onCopyTerminalCommand && worktree.mux === '✓' && may('terminal')) ? (
                <Menu>
                  <MenuTrigger className={iconButton} title={t('moreActions')} aria-label={t('moreActions')}>
                    <MoreHorizontal />
                  </MenuTrigger>
                  <MenuContent>
                    {onSyncPrs && may('write') ? (
                      <MenuItem icon={<RefreshCw />} onSelect={onSyncPrs}>
                        {t('syncPrs')}
                      </MenuItem>
                    ) : null}
                    {onCopyTerminalCommand && worktree.mux === '✓' && may('terminal') ? (
                      <MenuItem icon={<SquareTerminal />} onSelect={onCopyTerminalCommand}>
                        {t('copyTerminalCommand')}
                      </MenuItem>
                    ) : null}
                  </MenuContent>
                </Menu>
              ) : null}
            </>
          ) : null}
          {isMobile && worktree && hasMoreContent ? (
            <Popover>
              <PopoverTrigger className={iconButton} title={t('moreInfo')} aria-label={t('moreInfo')}>
                <MoreVertical />
              </PopoverTrigger>
              <PopoverContent align="end" className="max-w-[80vw]">
                <div className="flex flex-col gap-2">
                  <RepoGroup prs={mainPrs} onCiClick={onCiClick} onReviewsClick={onReviewsClick} />
                  {linkedRepoGroups.map((group) => (
                    <RepoGroup
                      key={group.alias}
                      label={group.alias}
                      prs={group.prs}
                      onCiClick={onCiClick}
                      onReviewsClick={onReviewsClick}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
          <Tooltip label={t('documentation')}>
            <a href={TASKFLOW_DOCS} className={cn(iconButton, 'ml-2')} aria-label={t('documentation')}>
              <BookOpen />
            </a>
          </Tooltip>
          <Popover open={bellOpen} onOpenChange={handleBellOpenChange}>
            <PopoverTrigger
              className={cn(iconButton, 'relative')}
              title={tc('notifications')}
              aria-label={tc('notifications')}
            >
              <Bell />
              {unreadCount > 0 ? (
                <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] leading-none text-accent-fg tabular-nums">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              ) : null}
            </PopoverTrigger>
            <PopoverContent align="end" padding="none" className="w-72">
              <div className={cn(overlayLabel, 'border-b border-line pb-1.5')}>{tc('notifications')}</div>
              {notificationHistory.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-subtle">{t('noNotifications')}</div>
              ) : (
                <ul className="max-h-64 list-none overflow-y-auto p-1 scroll-thin">
                  {notificationHistory.map((notification) => (
                    <li key={notification.id}>
                      <button
                        type="button"
                        className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-fill focus-ring"
                        onClick={() => {
                          onNotificationSelect?.(notification.branch)
                          setBellOpen(false)
                        }}
                      >
                        <NotificationItem notification={notification} showTimestamp />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
          <Tooltip label={t('settings')}>
            <button
              type="button"
              className={iconButton}
              title={t('settings')}
              aria-label={t('settings')}
              onClick={onSettings}
            >
              <Settings />
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
