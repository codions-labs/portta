// A byte-oriented console inside one running project container.
// Authentication and project scope are decided before the WebSocket exists;
// this owns the fixed shell argv, bounded lifetime and confirmed teardown.

import type { Duplex } from 'node:stream'
import type { Principal } from 'portta-auth-core'
import type { WebSocket } from 'ws'
import { z } from 'zod'
import type { AppDeps } from '../../deps.ts'
import { projectOfEnvironment } from '../../services/access-control.ts'
import { assertNotGatewayOwned, findContainer } from '../../services/actions.ts'
import { audit } from '../../services/audit.ts'
import { DockerApiError } from '../../services/docker/client.ts'
import { NotFound, type WsRoute } from './upgrade.ts'

const HEARTBEAT_MS = 30_000
const IDLE_MS = 15 * 60_000
const MAX_SESSION_MS = 2 * 60 * 60_000
const MAX_INPUT_BYTES = 64 * 1024

const query = z.object({
  service: z.string().min(1).max(128),
  shell: z.enum(['bash', 'sh']).optional(),
})
const resize = z
  .object({
    type: z.literal('resize'),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300),
  })
  .strict()

export function consoleRoute(deps: AppDeps): WsRoute {
  return {
    path: '/ws/environments/:name/console',
    permission: 'container:console',
    async scopeOf(params) {
      const snapshot = await deps.cache.get()
      const name = params.name ?? ''
      const environment = snapshot.environments.find((item) => item.name === name)
      if (!environment || environment.runningCount === 0) {
        throw new NotFound(`no environment '${name}' is running`)
      }
      return { projectId: await projectOfEnvironment(deps.db, name) }
    },
    handle(socket, { params, url, principal }) {
      const parsed = query.safeParse(Object.fromEntries(url.searchParams))
      if (!parsed.success) {
        socket.close(1008, 'invalid console parameters')
        return
      }
      void openConsole(deps, socket, principal, params.name ?? '', parsed.data)
    },
  }
}

function sendJson(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

function missingShell(error: unknown): boolean {
  return error instanceof DockerApiError && /executable file not found|no such file or directory/i.test(error.message)
}

async function attachShell(
  deps: AppDeps,
  containerId: string,
  preferred?: 'bash' | 'sh',
): Promise<{ execId: string; stream: Duplex; shell: '/bin/bash' | '/bin/sh' }> {
  const shells: Array<'/bin/bash' | '/bin/sh'> =
    preferred === 'bash' ? ['/bin/bash'] : preferred === 'sh' ? ['/bin/sh'] : ['/bin/bash', '/bin/sh']
  for (const shell of shells) {
    const execId = await deps.client.createConsoleExec(containerId, shell)
    try {
      return { execId, stream: await deps.client.attachConsoleExec(execId), shell }
    } catch (error) {
      if (!missingShell(error)) throw error
    }
  }
  throw new NotFound('this image has no supported shell (/bin/bash or /bin/sh)')
}

async function waitForExit(deps: AppDeps, execId: string, milliseconds: number): Promise<boolean> {
  const until = Date.now() + milliseconds
  do {
    const state = await deps.client.inspectConsoleExec(execId).catch(() => null)
    if (state && !state.Running) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  } while (Date.now() < until)
  return false
}

async function openConsole(
  deps: AppDeps,
  socket: WebSocket,
  principal: Principal,
  environmentName: string,
  options: z.infer<typeof query>,
): Promise<void> {
  let stream: Duplex | null = null
  let execId: string | null = null
  let openedAt = 0
  let lastActivity = Date.now()
  let finished: Promise<void> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let idle: ReturnType<typeof setInterval> | null = null
  let maximum: ReturnType<typeof setTimeout> | null = null
  let openingSettled = false
  let requestedFinish: string | null = null

  const finish = (reason = 'client closed'): Promise<void> => {
    if (finished) return finished
    finished = (async () => {
      if (heartbeat) clearInterval(heartbeat)
      if (idle) clearInterval(idle)
      if (maximum) clearTimeout(maximum)
      let teardownConfirmed = execId === null
      if (stream && execId) {
        // The #56 spike proved that destroying the hijack alone leaves the exec
        // running. Interrupt and exit while the hijack is still writable, then
        // verify with the only read endpoint Docker provides.
        if (!stream.destroyed && stream.writable) {
          stream.write(Buffer.from([3])) // terminal VINTR: Ctrl-C
          stream.write(Buffer.from('exit\n'))
          teardownConfirmed = await waitForExit(deps, execId, 1_500)
          if (!teardownConfirmed && !stream.destroyed && stream.writable) {
            stream.write(Buffer.from([28])) // terminal VQUIT: Ctrl-backslash
            stream.write(Buffer.from('exit\n'))
            teardownConfirmed = await waitForExit(deps, execId, 1_000)
          }
        } else {
          teardownConfirmed = await waitForExit(deps, execId, 300)
        }
        stream.destroy()
      }
      if (openedAt > 0) {
        await audit(deps.db.handle, principal, {
          action: 'container.console_closed',
          resourceType: 'container_console',
          resourceId: execId,
          resourceName: options.service,
          projectId: await projectOfEnvironment(deps.db, environmentName),
          metadata: {
            environment: environmentName,
            service: options.service,
            durationSeconds: Math.max(0, Math.floor((Date.now() - openedAt) / 1000)),
            reason,
            teardownConfirmed,
          },
        })
      }
    })()
    return finished
  }

  const requestFinish = (reason: string): Promise<void> => {
    requestedFinish ??= reason
    return openingSettled ? finish(requestedFinish) : Promise.resolve()
  }

  // A client can disappear while Docker is still establishing the hijacked
  // stream. Remember that close, but do not finalise before the possible exec
  // id and stream exist or they would escape teardown.
  socket.once('close', () => void requestFinish('client closed'))
  socket.once('error', () => void requestFinish('websocket error'))

  try {
    const snapshot = await deps.cache.get()
    const environment = snapshot.environments.find((item) => item.name === environmentName)
    if (!environment) throw new NotFound(`no environment '${environmentName}' is running`)
    const service = environment.services.find((item) => (item.service ?? item.name) === options.service)
    if (!service) throw new NotFound(`no service '${options.service}' in '${environmentName}'`)
    const container = findContainer(snapshot, service.id)
    assertNotGatewayOwned(container, 'open a console in')
    if (container.state !== 'running') throw new NotFound(`service '${options.service}' is not running`)

    const attached = await attachShell(deps, container.id, options.shell)
    stream = attached.stream
    execId = attached.execId
    if (socket.readyState !== socket.OPEN) {
      openingSettled = true
      await finish(requestedFinish ?? 'client closed while opening')
      return
    }

    openedAt = Date.now()
    const projectId = await projectOfEnvironment(deps.db, environmentName)
    await audit(deps.db.handle, principal, {
      action: 'container.console_opened',
      resourceType: 'container_console',
      resourceId: execId,
      resourceName: container.name,
      projectId,
      metadata: {
        environment: environmentName,
        container: container.name,
        service: options.service,
        shell: attached.shell,
      },
    })
    if (socket.readyState !== socket.OPEN) {
      openingSettled = true
      await finish(requestedFinish ?? 'client closed while opening')
      return
    }
    sendJson(socket, { kind: 'open', environment: environmentName, service: options.service, shell: attached.shell })

    stream.on('data', (chunk: Buffer) => {
      lastActivity = Date.now()
      if (socket.readyState === socket.OPEN) socket.send(chunk, { binary: true })
    })
    stream.once('end', () => {
      if (socket.readyState === socket.OPEN) socket.close(1000, 'console exited')
      void requestFinish('exec exited')
    })
    stream.once('close', () => {
      if (socket.readyState === socket.OPEN) socket.close(1000, 'console ended')
      void requestFinish('exec stream closed')
    })
    stream.once('error', () => {
      sendJson(socket, { kind: 'error', message: 'the console stream failed' })
      if (socket.readyState === socket.OPEN) socket.close(1011, 'console failed')
      void requestFinish('docker stream error')
    })

    socket.on('message', (data, binary) => {
      lastActivity = Date.now()
      if (!stream || stream.destroyed || !stream.writable) return
      if (binary) {
        const input = Buffer.from(data as ArrayBuffer)
        if (input.length <= MAX_INPUT_BYTES) stream.write(input)
        else socket.close(1009, 'console input frame is too large')
        return
      }
      try {
        const message = resize.parse(JSON.parse(String(data)))
        void deps.client.resizeConsoleExec(execId!, message.cols, message.rows).catch(() => {
          sendJson(socket, { kind: 'error', message: 'the terminal could not be resized' })
        })
      } catch {
        socket.close(1008, 'invalid console control message')
      }
    })

    heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping()
    }, HEARTBEAT_MS)
    idle = setInterval(
      () => {
        if (Date.now() - lastActivity < IDLE_MS) return
        sendJson(socket, { kind: 'notice', message: 'The console closed after 15 minutes without activity.' })
        void finish('idle timeout').then(() => {
          if (socket.readyState === socket.OPEN) socket.close(1000, 'idle timeout')
        })
      },
      Math.min(HEARTBEAT_MS, IDLE_MS),
    )
    maximum = setTimeout(() => {
      sendJson(socket, { kind: 'notice', message: 'The console reached its two-hour session limit.' })
      void finish('maximum duration').then(() => {
        if (socket.readyState === socket.OPEN) socket.close(1000, 'maximum duration')
      })
    }, MAX_SESSION_MS)
    openingSettled = true
    if (requestedFinish) await finish(requestedFinish)
  } catch (error) {
    openingSettled = true
    const message =
      error instanceof NotFound || (error instanceof Error && error.name === 'ActionRefused')
        ? error.message
        : 'the container console could not be opened'
    sendJson(socket, { kind: 'error', message })
    if (socket.readyState === socket.OPEN) socket.close(error instanceof NotFound ? 1008 : 1011, message)
    await finish(requestedFinish ?? 'open failed')
  }
}
