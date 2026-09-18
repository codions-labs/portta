'use client'

import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ComponentType, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useWorktreeCreationPhaseLabel } from '../../lib/phase-labels.ts'
import { usePreferences } from '../../lib/preferences.tsx'
import { useTaskflowProject } from '../../lib/project.tsx'
import { useConfig } from '../../lib/queries/config.ts'
import type { DiffDialogProps, PrEntry } from '../../lib/types.ts'
import {
  errorMessage,
  loadSavedSelectedWorktree,
  makeCursorUrl,
  resolveSelectedBranch,
  saveSelectedWorktree,
} from '../../lib/utils.ts'
import { MobileChatSurface } from '../chat/mobile-chat-surface.tsx'
import { EnvironmentPanel } from '../environments/environment-panel.tsx'
import { useNotifications } from '../shell/notifications.tsx'
import { useSidebarState } from '../shell/sidebar-state.tsx'
import { TopBar } from '../shell/top-bar.tsx'
import { PaneBar } from '../terminal/pane-bar.tsx'
import { TabBar } from '../terminal/tab-bar.tsx'
import { Terminal, type TerminalHandle } from '../terminal/terminal.tsx'
import { CiDetailsDialog } from './ci-details-dialog.tsx'
import { CommentReviewDialog } from './comment-review-dialog.tsx'
import { useWorktreeActions } from './worktree-actions.tsx'
import { useWorktreeSelection } from './worktree-selection.tsx'

/**
 * A worktree's page: its header, its runtime and the session itself — a
 * terminal, the web chat, or what to do while it is closed or still being
 * created. With no worktree in the URL it picks the one to show and replaces
 * the URL, the way the dashboard always reopened the last worktree.
 */
export function WorktreeView({ branch }: { branch: string | null }) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'view' })
  const router = useRouter()
  const { api, paths, prefix } = useTaskflowProject()
  const toast = useToast()
  const config = useConfig()
  const { sshHost, terminalTheme } = usePreferences()
  const { isMobile, toggleSidebar } = useSidebarState()
  const notifications = useNotifications()
  const actions = useWorktreeActions()
  const selection = useWorktreeSelection()
  const phaseLabel = useWorktreeCreationPhaseLabel()
  const { worktrees, hasLoadedWorktrees, visibleWorktrees, trimmedSearch } = selection
  const terminalRef = useRef<TerminalHandle>(null)
  const [activePane, setActivePane] = useState(0)
  const [tabBusy, setTabBusy] = useState(false)
  const [ciDetailsPr, setCiDetailsPr] = useState<PrEntry | null>(null)
  const [commentReviewPr, setCommentReviewPr] = useState<PrEntry | null>(null)
  const [DiffDialog, setDiffDialog] = useState<ComponentType<DiffDialogProps> | null>(null)
  const [showDiffDialog, setShowDiffDialog] = useState(false)
  const [savedBranch] = useState(() => loadSavedSelectedWorktree(prefix))

  const selectedBranch = branch && !actions.removing.has(branch) ? branch : null
  const selectableWorktrees = visibleWorktrees.filter((worktree) => !actions.removing.has(worktree.branch))
  const selectedWorktree = selectedBranch ? worktrees.find((worktree) => worktree.branch === selectedBranch) : undefined
  const canConnect = Boolean(selectedBranch && selectedWorktree?.mux === '✓' && !selectedWorktree.creating)
  const selectedAgent = selectedWorktree?.agentName
    ? config.agents.find((candidate) => candidate.id === selectedWorktree.agentName)
    : undefined
  const supportsChat =
    selectedAgent?.capabilities.inAppChat ??
    (selectedWorktree?.agentName === 'codex' || selectedWorktree?.agentName === 'claude')
  const showWebChat =
    selectedWorktree?.interfaceMode === 'web_chat' && canConnect && Boolean(selectedWorktree?.agentName) && supportsChat
  const showTabBar =
    canConnect && !showWebChat && (selectedWorktree?.agentName === 'claude' || selectedWorktree?.agentName === 'codex')
  const isOpening = selectedBranch ? actions.opening.has(selectedBranch) : false
  const paneBarPanes = Array.from({ length: selectedWorktree?.paneCount ?? 0 }, (_, index) => ({
    index,
    label: String(index + 1),
  }))
  const showPaneBar = isMobile && canConnect && !showWebChat && paneBarPanes.length > 1

  // The URL names a worktree that is gone, or none at all: pick the one to show,
  // starting from the one this browser had open last.
  useEffect(() => {
    const requested = branch ?? savedBranch
    const requestedWorktree = requested ? worktrees.find((worktree) => worktree.branch === requested) : undefined
    const requestedVisible = requested ? visibleWorktrees.find((worktree) => worktree.branch === requested) : undefined
    const next = resolveSelectedBranch(
      requested && !actions.removing.has(requested) ? requested : null,
      trimmedSearch ? requestedWorktree : requestedVisible,
      selectableWorktrees,
      hasLoadedWorktrees,
    )
    if (next !== branch && (hasLoadedWorktrees || next !== null)) selection.navigateTo(next, { replace: true })
  })

  useEffect(() => {
    if (!hasLoadedWorktrees) return
    if (selectedWorktree) saveSelectedWorktree(prefix, selectedWorktree.branch)
    else if (selectableWorktrees.length === 0) saveSelectedWorktree(prefix, null)
  }, [hasLoadedWorktrees, prefix, selectableWorktrees.length, selectedWorktree])

  async function runTabAction(
    action: () => Promise<void>,
    failure: 'createTabFailed' | 'selectTabFailed' | 'deleteTabFailed',
  ): Promise<void> {
    if (!selectedBranch || tabBusy) return
    setTabBusy(true)
    try {
      await action()
      await actions.refresh()
    } catch (error) {
      toast.push({ tone: 'danger', title: t(failure, { error: errorMessage(error) }) })
    } finally {
      setTabBusy(false)
    }
  }

  async function openDiffDialog(): Promise<void> {
    try {
      if (!DiffDialog) {
        const loaded = await import('./diff-dialog.tsx')
        setDiffDialog(() => loaded.DiffDialog)
      }
      setShowDiffDialog(true)
    } catch (error) {
      toast.push({ tone: 'danger', title: t('diffLoadFailed'), description: errorMessage(error) })
    }
  }

  const worktreeName = selectedWorktree ? (
    <div>
      <p className="text-sm font-medium text-ink">{selectedWorktree.label ?? selectedWorktree.branch}</p>
      {selectedWorktree.label ? <p className="text-2xs text-subtle">{selectedWorktree.branch}</p> : null}
    </div>
  ) : null

  return (
    <>
      <TopBar
        name={selectedWorktree?.branch ?? null}
        worktree={selectedWorktree}
        sshHost={sshHost}
        linkedRepos={config.linkedRepos ?? []}
        isMobile={isMobile}
        notificationHistory={notifications.history}
        unreadCount={notifications.unreadCount}
        onToggleSidebar={toggleSidebar}
        onClose={() => {
          if (selectedBranch) actions.close(selectedBranch)
        }}
        onArchive={() => {
          if (selectedBranch) actions.toggleArchived(selectedBranch)
        }}
        onMerge={() => {
          if (selectedBranch) actions.requestMerge(selectedBranch)
        }}
        onRemove={() => {
          if (selectedBranch) actions.requestRemove(selectedBranch)
        }}
        onEditLabel={() => {
          if (selectedWorktree) actions.editLabel(selectedWorktree.branch)
        }}
        onSyncPrs={() => {
          if (selectedBranch) actions.syncPrs(selectedBranch)
        }}
        onCopyTerminalCommand={() => {
          if (selectedBranch) actions.copyNativeTerminalCommand(selectedBranch)
        }}
        allowed={actions.allowed}
        onSettings={() => router.push(paths.settings())}
        onDirtyClick={() => {
          void openDiffDialog()
        }}
        onCiClick={setCiDetailsPr}
        onReviewsClick={setCommentReviewPr}
        onBellOpen={notifications.markAllRead}
        onNotificationSelect={selection.select}
        archiving={selectedBranch ? actions.archiving.has(selectedBranch) : false}
      />
      {selectedWorktree?.environmentId ? (
        <div className="shrink-0 border-b border-line bg-surface p-2">
          <EnvironmentPanel
            environmentId={selectedWorktree.environmentId}
            interfaceMode={selectedWorktree.interfaceMode}
          />
        </div>
      ) : null}
      {showWebChat && selectedWorktree ? (
        <MobileChatSurface
          key={selectedBranch}
          worktree={selectedWorktree}
          onConversationMessageSent={() => {
            void actions.refresh()
          }}
        />
      ) : canConnect && selectedBranch && !actions.allowed.terminal ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-subtle">
          <p>{t('terminalNotAllowed')}</p>
        </div>
      ) : canConnect && selectedBranch ? (
        <>
          {showTabBar && selectedWorktree ? (
            <TabBar
              tabs={selectedWorktree.tabs}
              activeTabId={selectedWorktree.activeTabId}
              busy={tabBusy}
              onCreate={() => {
                void runTabAction(() => api.createWorktreeTab(selectedBranch).then(() => undefined), 'createTabFailed')
              }}
              onSelect={(tabId) => {
                void runTabAction(() => api.selectWorktreeTab(selectedBranch, tabId), 'selectTabFailed')
              }}
              onDelete={(tabId) => {
                void runTabAction(() => api.deleteWorktreeTab(selectedBranch, tabId), 'deleteTabFailed')
              }}
            />
          ) : null}
          <Terminal
            key={`${selectedBranch}:${actions.terminalSessionRevision(selectedBranch)}`}
            ref={terminalRef}
            worktree={selectedBranch}
            isMobile={isMobile}
            initialPane={isMobile ? activePane : undefined}
            terminalTheme={terminalTheme}
            agentTerminalStale={selectedWorktree?.agentTerminalStale ?? false}
            refreshingAgentTerminal={actions.refreshingAgentTerminal.has(selectedBranch)}
            onRefreshAgentTerminal={() => actions.refreshAgentTerminal(selectedBranch)}
          />
        </>
      ) : selectedWorktree?.creating ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 aria-hidden className="size-6 animate-spin text-subtle" />
            {worktreeName}
            <p className="text-xs text-subtle">{phaseLabel(selectedWorktree.creationPhase)}</p>
          </div>
        </div>
      ) : selectedWorktree ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="flex flex-col items-center gap-4 text-center">
            {worktreeName}
            <div className="flex flex-col items-center gap-1 text-xs text-subtle">
              {selectedWorktree.profile ? <span>{t('profile', { profile: selectedWorktree.profile })}</span> : null}
              {(selectedWorktree.agentLabel ?? selectedWorktree.agentName) ? (
                <span>{t('agent', { agent: selectedWorktree.agentLabel ?? selectedWorktree.agentName })}</span>
              ) : null}
              {selectedWorktree.agentName && !supportsChat ? <span>{t('terminalOnly')}</span> : null}
            </div>
            {actions.allowed.write ? (
              <Button
                variant="primary"
                className="mt-2"
                busy={isOpening}
                onClick={() => actions.open(selectedWorktree.branch)}
              >
                {isOpening ? t('opening') : t('openSession')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm text-subtle">
          <p>{t('selectPrompt')}</p>
        </div>
      )}
      {showPaneBar ? (
        <PaneBar
          activePane={activePane}
          panes={paneBarPanes}
          onSelect={(pane) => {
            setActivePane(pane)
            terminalRef.current?.sendSelectPane(pane)
          }}
        />
      ) : null}
      {ciDetailsPr ? (
        <CiDetailsDialog
          pr={ciDetailsPr}
          branch={selectedWorktree?.branch ?? ''}
          onClose={() => setCiDetailsPr(null)}
          onFixSuccess={() => setCiDetailsPr(null)}
        />
      ) : null}
      {commentReviewPr ? (
        <CommentReviewDialog
          pr={commentReviewPr}
          branch={selectedWorktree?.branch ?? ''}
          onClose={() => setCommentReviewPr(null)}
          onSendSuccess={() => setCommentReviewPr(null)}
        />
      ) : null}
      {showDiffDialog && selectedBranch && DiffDialog ? (
        <DiffDialog
          branch={selectedBranch}
          cursorUrl={makeCursorUrl(selectedWorktree?.dir, sshHost)}
          onClose={() => setShowDiffDialog(false)}
        />
      ) : null}
    </>
  )
}
