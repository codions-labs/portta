'use client'

// What the daemon pushes, turned into cache updates, the way the panel's own
// `lib/live.ts` turns Docker's events into invalidations.
//
// The notification stream says an agent changed state, so the worktree list is
// stale. A Run's event stream appends to its timeline and makes the Run and the
// Run list stale. An execution's transcript stream appends entries. Nothing
// here polls: the streams decide when a query refetches.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTaskflowProject } from './project.tsx'
import { applyRunEvents, emptyRunTimeline } from './run-timeline.ts'
import type { AppNotification, RunTimelineState, TranscriptEntry } from './types.ts'

export interface NotificationHandlers {
  onNotification: (notification: AppNotification) => void
  onDismiss: (id: number) => void
  onInitial: (notification: AppNotification) => void
}

/** The project's notification stream. A new notification means an agent moved, so worktrees refetch. */
export function useNotificationStream(handlers: NotificationHandlers): void {
  const queryClient = useQueryClient()
  const { api, keys } = useTaskflowProject()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(
    () =>
      api.subscribeNotifications({
        onNotification: (notification) => {
          handlersRef.current.onNotification(notification)
          void queryClient.invalidateQueries({ queryKey: keys.worktrees() })
        },
        onDismiss: (id) => handlersRef.current.onDismiss(id),
        onInitial: (notification) => handlersRef.current.onInitial(notification),
      }),
    [api, keys, queryClient],
  )
}

/**
 * A Run's journal: the replay, then every event the stream appends. Each event
 * makes the Run and the Run list stale; a refetch of the Run already in flight
 * absorbs the next events instead of starting another one.
 */
export function useRunTimeline(runId: string | null, onDisconnect: () => void): RunTimelineState {
  const queryClient = useQueryClient()
  const { api, keys } = useTaskflowProject()
  const onDisconnectRef = useRef(onDisconnect)
  onDisconnectRef.current = onDisconnect
  const [timeline, setTimeline] = useState<RunTimelineState>(emptyRunTimeline)
  const replay = useQuery({
    queryKey: keys.runEvents(runId ?? ''),
    queryFn: () => api.fetchRunEvents(runId ?? ''),
    enabled: runId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })

  useEffect(() => {
    const events = replay.data
    if (!runId || !events) {
      setTimeline(emptyRunTimeline())
      return
    }
    setTimeline(applyRunEvents(emptyRunTimeline(), events.events))
    let refreshing = false
    return api.connectRunEventStream(runId, events.nextCursor, {
      onEvent: (event) => {
        setTimeline((current) => applyRunEvents(current, [event]))
        if (!refreshing) {
          refreshing = true
          void queryClient.invalidateQueries({ queryKey: keys.run(runId) }).finally(() => {
            refreshing = false
          })
        }
        void queryClient.invalidateQueries({ queryKey: keys.runs() })
      },
      onError: () => onDisconnectRef.current(),
    })
  }, [api, keys, queryClient, replay.data, runId])

  return timeline
}

/** An execution's transcript: the snapshot, then the entries its stream appends, each once. */
export function useExecutionTranscript(
  executionId: string | null,
  enabled: boolean,
  onDisconnect: () => void,
): { entries: TranscriptEntry[]; loading: boolean; error: unknown } {
  const { api, keys } = useTaskflowProject()
  const onDisconnectRef = useRef(onDisconnect)
  onDisconnectRef.current = onDisconnect
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const snapshot = useQuery({
    queryKey: keys.executionTranscript(executionId ?? ''),
    queryFn: () => api.fetchExecutionTranscript(executionId ?? ''),
    enabled: enabled && executionId !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  })

  useEffect(() => {
    const data = snapshot.data
    if (!executionId || !enabled || !data) {
      setEntries([])
      return
    }
    setEntries(data.entries)
    return api.connectExecutionTranscriptStream(executionId, data.nextCursor, {
      onEntry: (entry) =>
        setEntries((current) =>
          current.some((candidate) => candidate.cursor === entry.cursor) ? current : [...current, entry],
        ),
      onError: () => onDisconnectRef.current(),
    })
  }, [api, enabled, executionId, snapshot.data])

  return { entries, loading: snapshot.isFetching, error: snapshot.error }
}
