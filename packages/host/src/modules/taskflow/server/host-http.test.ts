import { describe, expect, it } from 'vitest'
import { createTaskflowHostApp } from './app.ts'
import type { HostProjects } from './host-projects.ts'

const noProjects: HostProjects = {
  get: () => undefined,
  list: () => [{ prefix: 'alpha', name: 'Alpha', path: '/repo/alpha', active: false }],
  register: () => {
    throw new Error('Not a git repository: /nowhere')
  },
  remove: () => false,
  inits: () => [],
}

describe('createTaskflowHostApp', () => {
  it('serves global routes and refuses unknown Projects and paths', async () => {
    const app = createTaskflowHostApp({ projects: noProjects, hasValidToken: async () => false })

    expect(await (await app.request('/api/projects')).json()).toEqual({ projects: noProjects.list() })
    const added = await app.request('/api/projects', { method: 'POST', body: JSON.stringify({ path: '/nowhere' }) })
    expect(added.status).toBe(400)
    expect(await added.json()).toEqual({ error: 'Not a git repository: /nowhere' })

    const unknown = await app.request('/beta/api/worktrees/feature%2Fsearch/diff')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toEqual({ error: 'Project not found' })

    const invalid = await app.request('/beta/api/notifications/abc/dismiss', { method: 'POST' })
    expect(invalid.status).toBe(400)

    expect((await app.request('/beta/worktrees/feature')).status).toBe(404)

    const hook = await app.request('/alpha/api/runtime/events', { method: 'POST', body: '{}' })
    expect(hook.status).toBe(401)
  })
})
