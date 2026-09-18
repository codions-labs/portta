'use client'

import { type QueryClient, type QueryKey, useQueryClient } from '@tanstack/react-query'
import type { LiveEvent } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { keys } from './queries/keys.ts'

export type LiveState = 'connecting' | 'live' | 'offline'

/**
 * Which cache entries one event makes stale.
 *
 * A container event touches what is running (environments, services, Docker,
 * the counters on the overview and the TCP services on Access), and nothing
 * else: a settings page or a Git snapshot has no reason to refetch because a
 * container restarted. Kinds the server has not started emitting yet —
 * session, activity, repository — fall into the project set, so a newer
 * server never leaves an older page stale.
 */
export function keysFor(event: Pick<LiveEvent, 'kind' | 'action' | 'name' | 'project'>): QueryKey[] {
  const runtime: QueryKey[] = [
    keys.environments(),
    keys.services(),
    keys.docker(),
    keys.status(),
    keys.overview(),
    keys.access(),
    keys.metricsCurrent(),
  ]
  const work: QueryKey[] = [keys.projects(), ['issues'], keys.overview(), keys.activity()]

  switch (event.kind) {
    case 'hello':
      return [[]]
    case 'container':
    case 'health':
    case 'project':
    case 'network':
    case 'bridge':
      return event.project ? [...runtime, keys.environment(event.project), keys.projects()] : runtime
    case 'config':
      if (event.action === 'issue') return work
      if (event.action === 'github') return [keys.forgeStatus(), ...work]
      if (event.action === 'overrides') return [keys.environments(), keys.services(), keys.status()]
      return [keys.config(), keys.gateway(), keys.status()]
    default:
      return event.project ? [...work, keys.environment(event.project), ['repositories']] : work
  }
}

export function invalidateFor(
  queryClient: QueryClient,
  event: Pick<LiveEvent, 'kind' | 'action' | 'name' | 'project'>,
): void {
  for (const queryKey of keysFor(event)) {
    void queryClient.invalidateQueries(queryKey.length === 0 ? undefined : { queryKey })
  }
}

/**
 * Docker's event stream, relayed by the server. The panel refetches what an
 * event made stale instead of polling; the short debounce keeps a
 * `docker compose up` from triggering a dozen refetches in a row, and events
 * that arrive inside the window are merged rather than dropped.
 */
export function useLive(): { state: LiveState; last: LiveEvent | null } {
  const queryClient = useQueryClient()
  const [state, setState] = useState<LiveState>('connecting')
  const [last, setLast] = useState<LiveEvent | null>(null)

  useEffect(() => {
    const source = new EventSource('/api/events')
    let timer: ReturnType<typeof setTimeout> | null = null
    let pending: LiveEvent[] = []

    const flush = () => {
      timer = null
      const batch = pending
      pending = []
      for (const event of batch) invalidateFor(queryClient, event)
    }

    const onEvent = (event: MessageEvent<string>) => {
      setState('live')
      let parsed: LiveEvent | null = null
      try {
        parsed = JSON.parse(event.data) as LiveEvent
      } catch {
        /* a keepalive is not JSON */
      }
      if (!parsed) return
      setLast(parsed)
      pending.push(parsed)
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 250)
    }

    source.addEventListener('hello', () => setState('live'))
    source.addEventListener('ping', () => setState('live'))
    for (const kind of [
      'container',
      'network',
      'bridge',
      'health',
      'project',
      'config',
      'session',
      'activity',
      'repository',
    ]) {
      source.addEventListener(kind, onEvent as EventListener)
    }
    source.onerror = () => setState('offline')
    source.onopen = () => setState('live')

    return () => {
      if (timer) clearTimeout(timer)
      source.close()
    }
  }, [queryClient])

  return { state, last }
}
