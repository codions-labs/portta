// Where the daemon serves Taskflow, and who it lets in: the paths the panel
// forwards 1:1, behind the daemon's token.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { type RunningHost, startHost } from '../src/main.ts'
import { HOST_MODULES } from '../src/modules/index.ts'
import { createTaskflowHostModule, taskflowHostModule } from '../src/modules/taskflow/index.ts'
import { createTaskflowHostApp } from '../src/modules/taskflow/server/app.ts'
import type { TaskflowHost } from '../src/modules/taskflow/server/host.ts'
import type { HostProjects } from '../src/modules/taskflow/server/host-projects.ts'
import type { ProjectApp } from '../src/modules/taskflow/server/project-app.ts'
import { agentsSocketRoute } from '../src/modules/taskflow/server/ws/agents.ts'
import { ProjectSockets } from '../src/modules/taskflow/server/ws/sockets.ts'
import { terminalSocketRoute } from '../src/modules/taskflow/server/ws/terminal.ts'
import { projectSocketRoutes, type WsRoute } from '../src/modules/taskflow/server/ws/upgrade.ts'

const TOKEN = 'a-long-random-host-token'
const bearer = { authorization: `Bearer ${TOKEN}` }

const alpha = { prefix: 'alpha', runtime: {} } as unknown as ProjectApp
const apps = new Map([['alpha', alpha]])
const projects: HostProjects = {
  get: (prefix) => apps.get(prefix),
  list: () => [{ prefix: 'alpha', name: 'Alpha', path: '/repo/alpha', active: false }],
  register: () => {
    throw new Error('the test registers no Project')
  },
  remove: () => false,
  inits: () => [],
}

const cleaned: string[] = []
const echo = (path: string): WsRoute => ({
  path,
  handle: (socket, { params, project }) => {
    socket.send(`open:${project.prefix}:${params.worktree ?? params.name}`)
    return () => {
      cleaned.push(params.worktree ?? params.name ?? '')
    }
  },
})

let shutdowns = 0
const fakeHost = (): TaskflowHost => ({
  app: createTaskflowHostApp({
    projects,
    hasValidToken: async (request) => request.headers.get('authorization') === `Bearer ${TOKEN}`,
  }),
  sockets: projectSocketRoutes([echo(agentsSocketRoute.path), echo(terminalSocketRoute.path)], {
    projects: apps,
    sockets: new ProjectSockets(() => {}),
  }),
  projects,
  loadProjects: () => {},
  shutdown: async () => {
    shutdowns += 1
  },
})

describe('the Taskflow host module', () => {
  it('is registered, and so mounted by every daemon', () => {
    expect(HOST_MODULES).toEqual([taskflowHostModule])
  })

  it('serves its sockets at the paths the panel forwards', () => {
    const module = createTaskflowHostModule({ createHost: fakeHost, start: async () => {} })
    const paths = module.ws?.({ stateDir: '/tmp/unused', env: {} }).map((route) => route.path)
    expect(paths).toEqual([
      '/ws/modules/taskflow/:prefix/ws/agents/worktrees/:name',
      '/ws/modules/taskflow/:prefix/ws/:worktree',
    ])
  })
})

describe('the Taskflow module behind the daemon', () => {
  let running: RunningHost
  const module = createTaskflowHostModule({ createHost: fakeHost, start: async () => {} })

  beforeAll(async () => {
    running = await startHost({
      host: '127.0.0.1',
      port: 0,
      token: TOKEN,
      modules: [module],
      context: { stateDir: '/tmp/unused', env: {} },
    })
  })
  afterAll(async () => running.close())

  it('answers its HTTP routes under /api/modules/taskflow, only with the token', async () => {
    const projectsUrl = `${running.url}/api/modules/taskflow/api/projects`
    expect((await fetch(projectsUrl)).status).toBe(401)
    const listed = await fetch(projectsUrl, { headers: bearer })
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ projects: projects.list() })

    const unknown = await fetch(`${running.url}/api/modules/taskflow/beta/api/worktrees`, { headers: bearer })
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'Project not found' })

    // An agent hook reaches the runtime-event route with the same token, and nothing else does.
    const hook = `${running.url}/api/modules/taskflow/alpha/api/runtime/events`
    expect((await fetch(hook, { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await fetch(hook, { method: 'POST', body: 'not json', headers: bearer })).status).toBe(400)
  })

  const open = (path: string, headers: Record<string, string>) =>
    new Promise<WebSocket | number>((resolve) => {
      const socket = new WebSocket(`${running.url.replace('http', 'ws')}${path}`, { headers })
      socket.once('open', () => resolve(socket))
      socket.once('unexpected-response', (_request, response) => resolve(response.statusCode ?? 0))
    })

  it('refuses a socket without the token, and one for an unknown Project, before the handshake', async () => {
    expect(await open('/ws/modules/taskflow/alpha/ws/main', {})).toBe(401)
    expect(await open('/ws/modules/taskflow/beta/ws/main', bearer)).toBe(404)
    expect(await open('/ws/modules/taskflow/alpha/api/worktrees', bearer)).toBe(404)
  })

  it('hands the terminal and agents sockets to their Project, and cleans up once closed', async () => {
    for (const [path, name] of [
      ['/ws/modules/taskflow/alpha/ws/feature%2Fsearch', 'feature/search'],
      ['/ws/modules/taskflow/alpha/ws/agents/worktrees/main', 'main'],
    ] as const) {
      const socket = new WebSocket(`${running.url.replace('http', 'ws')}${path}`, { headers: bearer })
      const first = await new Promise<string>((resolve, reject) => {
        socket.once('message', (data) => resolve(data.toString()))
        socket.once('unexpected-response', (_request, response) =>
          reject(new Error(`${path} refused with ${response.statusCode}`)),
        )
      })
      expect(first).toBe(`open:alpha:${name}`)
      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
      socket.close()
      await closed
    }
    await expect.poll(() => cleaned).toEqual(['feature/search', 'main'])
  })

  it('winds the Projects down when the daemon stops', async () => {
    await module.close?.()
    expect(shutdowns).toBe(1)
  })
})
