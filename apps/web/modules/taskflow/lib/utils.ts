import { UI_STORAGE_PREFIX } from 'portta-core/taskflow/config'
import type { PrEntry, WorktreeInfo } from './types.ts'

export { cn } from '@/lib/utils'

export const SSH_STORAGE_KEY = `${UI_STORAGE_PREFIX}.ssh-host`
export const LAST_SELECTED_WORKTREE_STORAGE_KEY = `${UI_STORAGE_PREFIX}.last-selected-worktree`
export const SIDEBAR_WIDTH_STORAGE_KEY = `${UI_STORAGE_PREFIX}.sidebar-width`
export const WEB_CHAT_UI_STORAGE_KEY = `${UI_STORAGE_PREFIX}.use-web-chat-ui`
const DEFAULT_SIDEBAR_WIDTH = 280

export function prLabel(pr: Pick<PrEntry, 'repo' | 'number'>): string {
  return pr.repo ? `${pr.repo} #${pr.number}` : `PR #${pr.number}`
}

export function isDraftPr(pr: Pick<PrEntry, 'state' | 'isDraft'>): boolean {
  return pr.state === 'open' && pr.isDraft
}

export function prStateTextClass(pr: Pick<PrEntry, 'state' | 'isDraft'>): string {
  if (pr.state === 'merged') return 'text-agent'
  if (pr.state === 'closed') return 'text-danger'
  if (isDraftPr(pr)) return 'text-muted'
  return 'text-ink'
}

export function prBadgeClass(pr: Pick<PrEntry, 'state' | 'isDraft'>): string {
  if (pr.state === 'merged') return 'bg-agent/20 text-agent'
  if (pr.state === 'closed') return 'bg-danger/20 text-danger'
  if (isDraftPr(pr)) return 'bg-muted/20 text-muted'
  if (pr.state === 'open') return 'bg-ok/20 text-ok'
  return 'bg-muted/20 text-muted'
}

export function ciStatusTextClass(ciStatus: PrEntry['ciStatus']): string {
  if (ciStatus === 'failed') return 'text-danger'
  if (ciStatus === 'success') return 'text-ok'
  if (ciStatus === 'pending') return 'text-warn'
  return 'text-muted'
}

export function ciStatusDotClass(ciStatus: PrEntry['ciStatus']): string {
  if (ciStatus === 'failed') return 'bg-danger'
  if (ciStatus === 'success') return 'bg-ok'
  if (ciStatus === 'pending') return 'bg-warn animate-pulse'
  return 'bg-muted'
}

export function prStatusShellClass(pr: Pick<PrEntry, 'ciChecks' | 'ciStatus' | 'state'>): string {
  if (pr.ciChecks.length > 0) {
    if (pr.ciStatus === 'failed') return 'border-danger/40 bg-danger/5'
    if (pr.ciStatus === 'pending') return 'border-warn/40 bg-warn/5'
    if (pr.ciStatus === 'success') return 'border-ok/30 bg-ok/5'
  }
  if (pr.state === 'merged') return 'border-agent/35 bg-agent/8'
  if (pr.state === 'closed') return 'border-danger/35 bg-danger/5'
  return 'border-line bg-surface'
}

export function makeCursorUrl(dir: string | null | undefined, sshHost: string | null): string | null {
  if (!dir) return null
  if (sshHost) return `cursor://vscode-remote/ssh-remote+${sshHost}${dir}`
  return `cursor://file${dir}`
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function searchMatch(needle: string, haystack: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

/** Browser storage that is absent while rendering on the server and may refuse in private mode. */
function readStored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // The choice still applies for this page.
  }
}

/** The last worktree opened in a Taskflow Project, so a return to its page reopens it. */
export function loadSavedSelectedWorktree(prefix: string): string | null {
  const stored = readStored(`${LAST_SELECTED_WORKTREE_STORAGE_KEY}.${prefix}`)?.trim()
  return stored ? stored : null
}

export function saveSelectedWorktree(prefix: string, branch: string | null): void {
  writeStored(`${LAST_SELECTED_WORKTREE_STORAGE_KEY}.${prefix}`, branch)
}

export function loadSavedSidebarWidth(): number {
  const stored = readStored(SIDEBAR_WIDTH_STORAGE_KEY)
  if (stored) {
    const n = Number.parseInt(stored, 10)
    if (!Number.isNaN(n) && n > 0) return n
  }
  return DEFAULT_SIDEBAR_WIDTH
}

export function saveSidebarWidth(width: number): void {
  writeStored(SIDEBAR_WIDTH_STORAGE_KEY, String(Math.round(width)))
}

export function loadUseWebChatUi(): boolean {
  return readStored(WEB_CHAT_UI_STORAGE_KEY) === 'true'
}

export function saveUseWebChatUi(enabled: boolean): void {
  writeStored(WEB_CHAT_UI_STORAGE_KEY, enabled ? 'true' : null)
}

export function loadSshHost(): string {
  return readStored(SSH_STORAGE_KEY) ?? ''
}

export function saveSshHost(host: string): void {
  writeStored(SSH_STORAGE_KEY, host.trim() || null)
}

export function resolveSelectedBranch(
  selectedBranch: string | null,
  selectedWorktree: Pick<WorktreeInfo, 'branch'> | undefined,
  selectableWorktrees: Array<Pick<WorktreeInfo, 'branch' | 'mux'>>,
  hasLoadedWorktrees: boolean,
): string | null {
  if (selectedBranch && selectedWorktree) return selectedBranch
  if (!hasLoadedWorktrees) return selectedBranch
  if (selectableWorktrees.length === 0) return null

  const open = selectableWorktrees.find((worktree) => worktree.mux === '✓')
  return (open ?? selectableWorktrees[0])?.branch ?? null
}
