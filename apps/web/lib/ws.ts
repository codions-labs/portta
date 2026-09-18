'use client'

// The panel's one WebSocket client.
//
// Following a log over polling would mean asking for the last 200 lines every
// few seconds: repeated requests for the same lines, a gap before anything
// appears, and a burst of work on the host every time somebody leaves the tab
// open. This holds one connection and receives what Docker sends.
//
// It reconnects, because a panel behind a proxy loses connections for reasons
// that have nothing to do with the panel, and it gives up saying so, because a
// viewer that reconnects forever is a viewer that never tells you the stream is
// not coming back.

import { useEffect, useRef, useState } from 'react'

export interface StreamedLine {
  stream: 'stdout' | 'stderr'
  timestamp: string | null
  text: string
  service?: string
}

export type StreamState = 'idle' | 'connecting' | 'open' | 'retrying' | 'failed'

/** Doubling from a second, capped: a host that is restarting is not helped by a flood. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 15_000]
/** How many lines a viewer keeps. Beyond this the top is dropped. */
const MAX_LINES = 5_000

export function socketUrl(path: string): string {
  const base = new URL(path, window.location.href)
  base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
  return base.toString()
}

export interface LogStream {
  lines: StreamedLine[]
  state: StreamState
  /** Forget what was received and reconnect. */
  reset: () => void
}

/**
 * Follow one service of one environment.
 *
 * `enabled` is the whole switch: turning it off closes the socket, and turning
 * it back on starts a new one from the tail. The lines are kept in a ref and
 * mirrored into state in batches, because a busy container can send more
 * frames per second than React should render.
 */
export function useLogStream(
  environment: string | null,
  service: string | null,
  options: { enabled: boolean; tail?: number } = { enabled: false },
): LogStream {
  const [lines, setLines] = useState<StreamedLine[]>([])
  const [state, setState] = useState<StreamState>('idle')
  // The counter is a ref and the trigger is a number that only ever goes up.
  // They were one piece of state once, and resetting it on a successful open
  // changed a dependency of the effect that had just opened: the socket was
  // torn down and redialled the moment it worked.
  const attempts = useRef(0)
  const [redial, setRedial] = useState(0)
  const buffer = useRef<StreamedLine[]>([])

  // biome-ignore lint/correctness/useExhaustiveDependencies: redial is the trigger that reopens the socket after a failure
  useEffect(() => {
    if (!options.enabled || !environment) {
      setState('idle')
      return
    }
    if (typeof WebSocket === 'undefined') {
      setState('failed')
      return
    }

    let closed = false
    let flush: ReturnType<typeof setInterval> | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const query = new URLSearchParams()
    if (service) query.set('service', service)
    if (options.tail) query.set('tail', String(options.tail))
    const suffix = query.toString()
    const socket = new WebSocket(
      socketUrl(`/ws/environments/${encodeURIComponent(environment)}/logs${suffix ? `?${suffix}` : ''}`),
    )
    setState('connecting')

    socket.onopen = () => {
      if (closed) return
      setState('open')
      attempts.current = 0
      flush = setInterval(() => {
        if (buffer.current.length === 0) return
        const batch = buffer.current
        buffer.current = []
        setLines((current) => [...current, ...batch].slice(-MAX_LINES))
      }, 120)
    }

    socket.onmessage = (event) => {
      const message = parse(event.data)
      if (!message) return
      for (const line of message.lines) buffer.current.push({ ...line, service: message.service })
    }

    socket.onclose = (event) => {
      if (closed) return
      if (flush) clearInterval(flush)
      // 1008 is the server refusing the parameters, and 1000 after a container
      // stopped is the stream ending on purpose. Neither is worth retrying.
      if (event.code === 1008 || event.code === 1000) {
        setState('failed')
        return
      }
      if (attempts.current >= BACKOFF_MS.length) {
        setState('failed')
        return
      }
      const wait = BACKOFF_MS[attempts.current]!
      attempts.current += 1
      setState('retrying')
      retry = setTimeout(() => setRedial((value) => value + 1), wait)
    }

    return () => {
      closed = true
      if (flush) clearInterval(flush)
      if (retry) clearTimeout(retry)
      socket.close()
    }
    // `redial` is in the list on purpose: incrementing it is what reconnects.
  }, [environment, service, options.enabled, options.tail, redial])

  return {
    lines,
    state,
    reset: () => {
      buffer.current = []
      setLines([])
      attempts.current = 0
    },
  }
}

interface LinesMessage {
  kind: 'lines'
  service: string
  lines: StreamedLine[]
}

/** The server's own frames, and nothing else: anything unrecognised is dropped. */
function parse(data: unknown): LinesMessage | null {
  if (typeof data !== 'string') return null
  try {
    const message = JSON.parse(data) as Partial<LinesMessage>
    if (message.kind !== 'lines' || !Array.isArray(message.lines)) return null
    return { kind: 'lines', service: String(message.service ?? ''), lines: message.lines }
  } catch {
    return null
  }
}
