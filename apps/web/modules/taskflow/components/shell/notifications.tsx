'use client'

// The agent notifications the server pushes: the toasts on screen, the bell's
// history, the unread count and the worktrees with something new to look at.

import { UI_STORAGE_PREFIX } from 'portta-core/taskflow/config'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNotificationStream } from '../../lib/live.ts'
import { useTaskflowProject } from '../../lib/project.tsx'
import type { AppNotification, ToastItem } from '../../lib/types.ts'
import { useSelectedBranch } from '../worktrees/use-selected-branch.ts'

const AUTO_DISMISS_MS = 4000
const MAX_HISTORY = 10

interface Notifications {
  toasts: ToastItem[]
  history: AppNotification[]
  unreadCount: number
  notifiedBranches: ReadonlySet<string>
  dismissToast: (id: string) => void
  markAllRead: () => void
  clearNotified: (branch: string) => void
}

const NotificationsContext = createContext<Notifications | null>(null)

function toastTone(notification: AppNotification): ToastItem['tone'] {
  if (notification.type === 'runtime_error') return 'error'
  if (notification.type === 'agent_stopped' || notification.type === 'worktree_auto_removed') return 'success'
  return 'info'
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { api } = useTaskflowProject()
  const selectedBranch = useSelectedBranch()
  const selectedBranchRef = useRef(selectedBranch)
  selectedBranchRef.current = selectedBranch
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [history, setHistory] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifiedBranches, setNotifiedBranches] = useState<ReadonlySet<string>>(new Set())

  useNotificationStream({
    onNotification: (notification) => {
      setNotifications((items) => [...items, notification])
      if (notification.branch !== selectedBranchRef.current || document.hidden)
        setNotifiedBranches((branches) => new Set([...branches, notification.branch]))
      setHistory((items) =>
        [notification, ...items.filter((item) => item.id !== notification.id)].slice(0, MAX_HISTORY),
      )
      setUnreadCount((count) => count + 1)
      window.setTimeout(
        () => setNotifications((items) => items.filter((item) => item.id !== notification.id)),
        AUTO_DISMISS_MS,
      )
      if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted')
        new Notification(notification.message, {
          body: notification.url ?? notification.branch,
          tag: `${UI_STORAGE_PREFIX}-${notification.id}`,
        })
    },
    onDismiss: (id) => setNotifications((items) => items.filter((notification) => notification.id !== id)),
    onInitial: (notification) =>
      setHistory((items) =>
        items.some((item) => item.id === notification.id) ? items : [notification, ...items].slice(0, MAX_HISTORY),
      ),
  })

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default')
      void Notification.requestPermission().catch(() => {})
  }, [])

  const toasts = useMemo<ToastItem[]>(
    () =>
      notifications.map((notification) => ({
        id: `notification:${notification.id}`,
        source: 'notification',
        notificationId: notification.id,
        tone: toastTone(notification),
        message: notification.message,
        ...(notification.url ? { detail: notification.url } : {}),
        branch: notification.branch,
      })),
    [notifications],
  )

  const dismissToast = useCallback(
    (id: string): void => {
      const toast = toasts.find((item) => item.id === id)
      if (!toast) return
      setNotifications((items) => items.filter((notification) => notification.id !== toast.notificationId))
      void api.dismissNotification(toast.notificationId).catch(() => {})
    },
    [api, toasts],
  )

  const clearNotified = useCallback((branch: string): void => {
    setNotifiedBranches((branches) => {
      if (!branches.has(branch)) return branches
      return new Set([...branches].filter((candidate) => candidate !== branch))
    })
  }, [])

  const markAllRead = useCallback(() => setUnreadCount(0), [])

  const value = useMemo(
    () => ({ toasts, history, unreadCount, notifiedBranches, dismissToast, markAllRead, clearNotified }),
    [clearNotified, dismissToast, history, markAllRead, notifiedBranches, toasts, unreadCount],
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): Notifications {
  const value = useContext(NotificationsContext)
  if (!value) throw new Error('NotificationsProvider is not mounted')
  return value
}
