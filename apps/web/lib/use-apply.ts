'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApplyStatus } from 'portta-contracts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api/index.ts'
import { keys } from './queries/keys.ts'

/**
 * Applying saved settings recreates the panel that is showing this dialog, so
 * the request that starts it is the last one this page will get an answer to
 * for a while. Everything after it is a poll, and the polling has to treat a
 * network error as the expected state rather than as a failure.
 *
 * The loop is plain timers rather than React Query: the retry and backoff of a
 * query fight a fixed budget, `useLive` invalidates every query at once on each
 * Docker event, and fake timers can drive a plain loop exactly in tests.
 */
export type ApplyPhase =
  | 'idle'
  | 'confirming'
  | 'starting'
  | 'applying'
  | 'waiting'
  | 'reconnected'
  | 'failed'
  | 'timeout'

const POLL_MS = 2_000
/** Each probe gets its own deadline, so a hung socket cannot stall the loop. */
const PROBE_MS = 1_500
/**
 * The gateway is not recreated instantly. Without a floor, the first probe —
 * which usually lands before Compose has stopped anything — would see a healthy
 * panel with nothing pending and declare success immediately.
 */
const GRACE_MS = 5_000
/**
 * How long to keep probing before calling it a timeout. The host's own
 * `--wait-timeout` is 180s, and matching it exactly leaves no room for the
 * apply to be *slower* than the gateway convergence it waits on — which is
 * every apply on a checkout, where `up --build` runs `npm ci` before Compose
 * converges at all. So: comfortably past the host on a host that builds, and
 * just past it on one that does not.
 */
const BUDGET_MS = 240_000
const BUILD_BUDGET_MS = 900_000

export interface ApplyMachine {
  phase: ApplyPhase
  busy: boolean
  elapsedSeconds: number
  sawOffline: boolean
  status: ApplyStatus | null
  error: unknown
  open: () => void
  confirm: () => void
  dismiss: () => void
}

export function useApply(): ApplyMachine {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<ApplyPhase>('idle')
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [elapsedSeconds, setElapsed] = useState(0)
  const [sawOffline, setSawOffline] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [live, setLive] = useState<ApplyStatus | null>(null)
  // Captured when the apply starts: without it, an apply of settings that were
  // already running would look finished before it began.
  const startedPending = useRef(false)

  // The resting state, and the only thing that knows an apply is in flight when
  // this tab was opened in the middle of one.
  const resting = useQuery({
    queryKey: keys.apply(),
    queryFn: () => api.applyStatus(),
    refetchInterval: (query) => (query.state.data?.state === 'running' ? 3_000 : false),
  })
  const status = live ?? resting.data ?? null

  // Resume rather than remember: an apply started in another tab, or before a
  // reload, is still running on the host, and its start time is the host's.
  useEffect(() => {
    if (phase !== 'idle') return
    if (resting.data?.state !== 'running') return
    startedPending.current = resting.data.pendingRestart
    setStartedAtMs((resting.data.startedAt ?? Math.floor(Date.now() / 1000)) * 1000)
    setPhase('waiting')
  }, [phase, resting.data])

  const busy = phase === 'starting' || phase === 'applying' || phase === 'waiting'

  useEffect(() => {
    if (startedAtMs === null) return
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)))
    tick()
    const timer = setInterval(tick, 1_000)
    return () => clearInterval(timer)
  }, [startedAtMs])

  // Stable across a run: the value comes from the host's .env, not from the
  // poll, so this never re-enters the loop below mid-apply.
  const budget = status?.buildsImages ? BUILD_BUDGET_MS : BUDGET_MS

  useEffect(() => {
    if (phase !== 'applying' && phase !== 'waiting') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const round = async () => {
      const controller = new AbortController()
      const deadline = setTimeout(() => controller.abort(), PROBE_MS)
      try {
        await api.healthProbe(controller.signal)
        const next = await api.applyProbe(controller.signal)
        if (cancelled) return
        setLive(next)

        if (next.state === 'failed') return setPhase('failed')

        const settled = next.pendingRestart === false && next.state !== 'running'
        // "The panel came back" is only evidence when we saw it leave. An apply
        // that recreates Traefik but not this container never goes offline, and
        // waiting for that would hang until the budget ran out; a clean exit
        // from the applier is the other honest proof.
        const proved = sawOffline || next.state === 'ok' || !startedPending.current
        if (Date.now() - (startedAtMs ?? 0) > GRACE_MS && settled && proved) {
          void queryClient.invalidateQueries()
          return setPhase('reconnected')
        }
        setPhase(sawOffline ? 'waiting' : 'applying')
      } catch (cause) {
        if (cancelled) return
        // The panel being unreachable is what applying looks like from here.
        // The one answer that is not a network failure is 401: new credentials
        // took effect, so it is back and asking to be let in.
        if (cause instanceof Error && 'status' in cause && (cause as { status: number }).status === 401) {
          return setPhase('reconnected')
        }
        setSawOffline(true)
        setPhase('waiting')
      } finally {
        clearTimeout(deadline)
      }

      if (cancelled) return
      if (Date.now() - (startedAtMs ?? 0) > budget) return setPhase('timeout')
      timer = setTimeout(() => void round(), POLL_MS)
    }

    timer = setTimeout(() => void round(), POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [phase, sawOffline, startedAtMs, queryClient, budget])

  const open = useCallback(() => {
    setError(null)
    setPhase('confirming')
  }, [])

  const confirm = useCallback(() => {
    startedPending.current = status?.pendingRestart ?? true
    setSawOffline(false)
    setError(null)
    setStartedAtMs(Date.now())
    setPhase('starting')
    api.apply().then(
      () => setPhase('applying'),
      (cause: unknown) => {
        // A rejection with no status is the panel dying before it could answer,
        // which is indistinguishable from success at this point. The poll below
        // decides; only a real refusal from a live panel is a failure here.
        if (cause instanceof Error && 'status' in cause && (cause as { status: number }).status >= 400) {
          setError(cause)
          setPhase('idle')
          return
        }
        setSawOffline(true)
        setPhase('waiting')
      },
    )
  }, [status])

  const dismiss = useCallback(() => {
    if (busy) return
    setPhase('idle')
    setLive(null)
    setStartedAtMs(null)
    setElapsed(0)
    setSawOffline(false)
  }, [busy])

  return { phase, busy, elapsedSeconds, sawOffline, status, error, open, confirm, dismiss }
}

/** mm:ss, for a stopwatch whose total is unknown. */
export function mmss(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
