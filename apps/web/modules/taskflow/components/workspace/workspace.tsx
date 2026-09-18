'use client'

// The frame every Taskflow page of a Project renders into: a sidebar with the
// section's list and a main column the page fills.
//
// The panel's own shell and the Project's tabs are around it; this adds what a
// section needs beside its page — the worktrees, the Runs or the workflow
// catalog — and the providers every page shares: this browser's preferences,
// the notification stream, the worktree selection and the actions.

import { BookOpen, Loader2, PanelLeftOpen, Plus, Settings, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Kbd, useModKey } from '@/components/ui/kbd'
import { iconButton } from '@/components/ui/surfaces'
import { Tooltip } from '@/components/ui/tooltip'
import { TASKFLOW_DOCS, taskflowLocation } from '../../lib/navigation.ts'
import { PreferencesProvider } from '../../lib/preferences.tsx'
import { useTaskflowProject } from '../../lib/project.tsx'
import { cn, loadSavedSidebarWidth, saveSidebarWidth } from '../../lib/utils.ts'
import { RunSidebar } from '../runs/run-sidebar.tsx'
import { NotificationsProvider, useNotifications } from '../shell/notifications.tsx'
import { SidebarStateProvider, useSidebarState } from '../shell/sidebar-state.tsx'
import { ToastStack } from '../shell/toast-stack.tsx'
import { useDashboardShortcuts } from '../shell/use-dashboard-shortcuts.ts'
import { WorkflowSidebar } from '../workflows/workflow-sidebar.tsx'
import { useWorktreeActions, WorktreeActionsProvider } from '../worktrees/worktree-actions.tsx'
import { useWorktreeSelection, WorktreeSelectionProvider } from '../worktrees/worktree-selection.tsx'
import { WorktreeFilters, WorktreeSidebar } from '../worktrees/worktree-sidebar.tsx'

const MIN_SIDEBAR_WIDTH = 180
const MAX_SIDEBAR_WIDTH = 480
const SIDEBAR_KEYBOARD_STEP = 10

function clampSidebarWidth(width: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width))
}

export function TaskflowWorkspace({ children }: { children: ReactNode }) {
  return (
    <PreferencesProvider>
      <SidebarStateProvider>
        <NotificationsProvider>
          <WorktreeSelectionProvider>
            <WorktreeActionsProvider>
              <WorkspaceFrame>{children}</WorkspaceFrame>
            </WorktreeActionsProvider>
          </WorktreeSelectionProvider>
        </NotificationsProvider>
      </SidebarStateProvider>
    </PreferencesProvider>
  )
}

function ShortcutHints() {
  const { t } = useTranslation('taskflow', { keyPrefix: 'shell.shortcuts' })
  const mod = useModKey()
  const rows: Array<{ label: string; keys: string[] }> = [
    { label: t('navigate'), keys: [mod, '↑', '↓'] },
    { label: t('newRun'), keys: [mod, '⇧', 'K'] },
    { label: t('merge'), keys: [mod, 'M'] },
    { label: t('remove'), keys: [mod, 'D'] },
  ]
  return (
    <div className="hidden shrink-0 flex-col gap-1 border-t border-line px-3 py-2.5 text-2xs text-subtle md:flex">
      {rows.map((row) => (
        <div className="flex items-center justify-between" key={row.label}>
          <span>{row.label}</span>
          <span className="flex gap-0.5">
            {row.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </div>
      ))}
    </div>
  )
}

function WorkspaceFrame({ children }: { children: ReactNode }) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'shell' })
  const { slug, paths } = useTaskflowProject()
  const section = taskflowLocation(usePathname(), slug).section ?? 'worktrees'
  const { isMobile, sidebarOpen, setSidebarOpen, closeOnMobile } = useSidebarState()
  const actions = useWorktreeActions()
  const { toasts, dismissToast, clearNotified } = useNotifications()
  const { navigateTo } = useWorktreeSelection()
  const [sidebarWidth, setSidebarWidth] = useState(() => clampSidebarWidth(loadSavedSidebarWidth()))
  const [isResizing, setIsResizing] = useState(false)
  const canCreate = actions.allowed.write || actions.allowed.runCreate

  useDashboardShortcuts()

  function handleResizeStart(event: ReactPointerEvent<HTMLDivElement>): void {
    event.preventDefault()
    setIsResizing(true)
    const startX = event.clientX
    const startWidth = sidebarWidth
    const onPointerMove = (moveEvent: PointerEvent): void =>
      setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX))
    const onPointerUp = (): void => {
      setIsResizing(false)
      setSidebarWidth((width) => {
        saveSidebarWidth(width)
        return width
      })
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function handleResizeKeydown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setSidebarWidth((width) => {
      const next = clampSidebarWidth(
        width + (event.key === 'ArrowRight' ? SIDEBAR_KEYBOARD_STEP : -SIDEBAR_KEYBOARD_STEP),
      )
      saveSidebarWidth(next)
      return next
    })
  }

  const sidebar = (
    <aside
      aria-label={t('sidebar')}
      className={cn(
        'flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface',
        isMobile && 'fixed inset-0 z-50 w-full border-r-0',
      )}
      style={isMobile ? undefined : { width: sidebarWidth }}
    >
      <div className="border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          {canCreate ? (
            <Button size="sm" variant="primary" onClick={() => actions.openCreate()} title={t('newRunTitle')}>
              <Plus aria-hidden />
              {t('new')}
            </Button>
          ) : (
            <span />
          )}
          {isMobile ? (
            <button
              type="button"
              className={cn(iconButton, 'size-7')}
              onClick={() => setSidebarOpen(false)}
              title={t('closeSidebar')}
              aria-label={t('closeSidebar')}
            >
              <X />
            </button>
          ) : null}
        </div>
        {actions.activeCreateCount > 0 ? (
          <div className="mt-2 flex items-center gap-1 text-2xs text-subtle" role="status">
            <Loader2 aria-hidden className="size-3 animate-spin" />
            {t('creating', { count: actions.activeCreateCount })}
          </div>
        ) : null}
        {section === 'worktrees' ? <WorktreeFilters /> : null}
      </div>
      {section === 'runs' ? <RunSidebar /> : section === 'workflows' ? <WorkflowSidebar /> : <WorktreeSidebar />}
      {section === 'worktrees' ? <ShortcutHints /> : null}
      <div className="flex shrink-0 items-center gap-0.5 border-t border-line px-2 py-1.5">
        <Tooltip label={t('settings')}>
          <Link
            href={paths.settings()}
            className={cn(iconButton, section === 'settings' && 'bg-fill-strong text-ink')}
            aria-label={t('settings')}
            aria-current={section === 'settings' ? 'page' : undefined}
            onClick={closeOnMobile}
          >
            <Settings />
          </Link>
        </Tooltip>
        <Tooltip label={t('documentation')}>
          <a href={TASKFLOW_DOCS} className={iconButton} aria-label={t('documentation')}>
            <BookOpen />
          </a>
        </Tooltip>
      </div>
    </aside>
  )

  return (
    // Absolutely placed inside a box that fills what the page leaves: the
    // terminal sizes itself to its container, and a container that grew with
    // the terminal would never stop growing.
    <div className="relative min-h-[32rem] flex-1">
      <div
        className={cn(
          'absolute inset-0 flex overflow-hidden rounded-lg border border-line bg-surface',
          isResizing && 'cursor-col-resize select-none',
        )}
      >
        {!isMobile || sidebarOpen ? (
          <>
            {isMobile ? (
              <button
                type="button"
                aria-label={t('closeSidebar')}
                className="fixed inset-0 z-40 bg-scrim"
                onClick={() => setSidebarOpen(false)}
              />
            ) : null}
            {sidebar}
            {!isMobile ? (
              <div
                className={cn(
                  '-ml-px w-1 shrink-0 cursor-col-resize transition-colors duration-100 hover:bg-accent/50',
                  isResizing && 'bg-accent',
                )}
                onPointerDown={handleResizeStart}
                onKeyDown={handleResizeKeydown}
                role="separator"
                aria-label={t('resizeSidebar')}
                aria-orientation="vertical"
                aria-valuenow={sidebarWidth}
                aria-valuemin={MIN_SIDEBAR_WIDTH}
                aria-valuemax={MAX_SIDEBAR_WIDTH}
                tabIndex={0}
              />
            ) : null}
          </>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {isMobile && !sidebarOpen && section !== 'worktrees' ? (
            <div className="flex shrink-0 items-center border-b border-line px-2 py-1.5">
              <button
                type="button"
                className={iconButton}
                onClick={() => setSidebarOpen(true)}
                aria-label={t('openSidebar')}
              >
                <PanelLeftOpen />
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
        onSelect={(id) => {
          const toast = toasts.find((item) => item.id === id)
          if (!toast) return
          dismissToast(id)
          navigateTo(toast.branch)
          clearNotified(toast.branch)
          closeOnMobile()
        }}
      />
    </div>
  )
}
