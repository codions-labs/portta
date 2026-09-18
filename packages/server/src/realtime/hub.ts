// Live updates, driven by Docker's own event stream.
//
// The panel does not poll: it subscribes once, invalidates its snapshot cache
// when something changes, and forwards a small event to every connected
// browser, which refetches only what that event touched.

import type { LiveEvent, Ownership } from 'portta-contracts'
import type { DockerClient } from '../services/docker/client.ts'
import type { SnapshotCache } from '../services/inventory.ts'
import { LABELS } from '../services/labels.ts'

const CONTAINER_ACTIONS = new Set([
  'create',
  'start',
  'stop',
  'die',
  'kill',
  'destroy',
  'restart',
  'rename',
  'pause',
  'unpause',
  'update',
])

type Listener = (event: LiveEvent) => void

export class LiveHub {
  private listeners = new Set<Listener>()
  private controller: AbortController | null = null
  private stopped = false
  private backoffMs = 500

  private client: DockerClient
  private cache: SnapshotCache

  constructor(client: DockerClient, cache: SnapshotCache) {
    this.client = client
    this.cache = cache
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get subscriberCount(): number {
    return this.listeners.size
  }

  publish(event: LiveEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A browser that went away mid-write must not take the hub down.
      }
    }
  }

  start(): void {
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    this.controller?.abort()
    this.controller = null
    this.listeners.clear()
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const controller = new AbortController()
      this.controller = controller
      try {
        for await (const raw of this.client.events(controller.signal)) {
          this.backoffMs = 500
          const event = translate(raw)
          if (!event) continue
          this.cache.invalidate()
          this.publish(event)
        }
      } catch {
        // The proxy restarted, or Docker went away. Try again, backing off.
      }
      if (this.stopped) return
      await new Promise((resolve) => setTimeout(resolve, this.backoffMs))
      this.backoffMs = Math.min(this.backoffMs * 2, 15_000)
    }
  }
}

function ownershipOf(attributes: Record<string, string>): Ownership | null {
  if (attributes[LABELS.managed] === 'true') return 'gateway'
  if (attributes[LABELS.composeProject]) return 'external'
  return 'standalone'
}

export function translate(raw: {
  Type?: string
  Action?: string
  Actor?: { ID?: string; Attributes?: Record<string, string> }
  time?: number
}): LiveEvent | null {
  const type = raw.Type ?? ''
  const action = (raw.Action ?? '').split(':')[0] ?? ''
  const attributes = raw.Actor?.Attributes ?? {}
  const at = raw.time ?? Math.floor(Date.now() / 1000)

  if (type === 'container') {
    const isHealth = (raw.Action ?? '').startsWith('health_status')
    if (!isHealth && !CONTAINER_ACTIONS.has(action)) return null
    const component = attributes[LABELS.component]
    const kind =
      component === 'access-bridge' || component === 'access-forwarder' ? 'bridge' : isHealth ? 'health' : 'container'
    return {
      kind,
      action: isHealth ? (raw.Action ?? 'health_status') : action,
      id: raw.Actor?.ID ?? null,
      name: attributes.name ?? null,
      project: attributes[LABELS.composeProject] ?? null,
      ownership: ownershipOf(attributes),
      at,
    }
  }

  if (type === 'network' && ['create', 'destroy', 'connect', 'disconnect'].includes(action)) {
    return {
      kind: 'network',
      action,
      id: raw.Actor?.ID ?? null,
      name: attributes.name ?? null,
      project: null,
      ownership: null,
      at,
    }
  }

  return null
}
