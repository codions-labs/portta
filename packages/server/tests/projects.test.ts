import type { Project } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import type { Database } from '../src/db/index.ts'
import { type ProjectCoordinates, resolveAdoption } from '../src/services/adoption.ts'
import { GATEWAY, PROJECT_A, PROJECT_B } from './fixtures.ts'
import { databasePerFile, del, makeApp, post } from './helpers.ts'

const PROJECTS: ProjectCoordinates[] = [
  { id: '1', slug: 'meu-produto', path: '/srv/projects/group/meu-produto' },
  { id: '2', slug: 'outro', path: '/srv/projects/outro' },
]

describe('adoption precedence', () => {
  const project = { name: 'alpha', group: null }

  it('adopts nothing when there is nothing to go on', () => {
    expect(resolveAdoption(project, PROJECTS, new Map())).toBeNull()
  })

  it('honours the portta.project label the project declared', () => {
    expect(resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map())).toEqual({
      projectId: '1',
      source: 'label',
    })
  })

  it('lets a manual mapping override the label', () => {
    expect(resolveAdoption({ ...project, group: 'meu-produto' }, PROJECTS, new Map([['alpha', '2']]))).toEqual({
      projectId: '2',
      source: 'manual',
    })
  })

  it('adopts by path: the working directory sits under the Project directory, at any depth', () => {
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/outro/deploy' }, PROJECTS, new Map())).toEqual({
      projectId: '2',
      source: 'path',
    })
    expect(
      resolveAdoption({ ...project, workingDir: '/srv/projects/group/meu-produto/api' }, PROJECTS, new Map()),
    ).toEqual({ projectId: '1', source: 'path' })
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/outrofold' }, PROJECTS, new Map())).toBeNull()
  })

  it('lets the deepest Project directory win over one that merely contains it', () => {
    const nested: ProjectCoordinates[] = [
      { id: '1', slug: 'parent', path: '/srv/projects/shop' },
      { id: '2', slug: 'child', path: '/srv/projects/shop/admin' },
    ]
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/shop/admin/app' }, nested, new Map())).toEqual({
      projectId: '2',
      source: 'path',
    })
  })

  it('adopts nothing when two Projects claim the same directory', () => {
    const ambiguous: ProjectCoordinates[] = [
      { id: '1', slug: 'one', path: '/srv/projects/shop' },
      { id: '2', slug: 'two', path: '/srv/projects/shop' },
    ]
    expect(resolveAdoption({ ...project, workingDir: '/srv/projects/shop/app' }, ambiguous, new Map())).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The endpoints
// ---------------------------------------------------------------------------

interface Store {
  projects: Map<
    string,
    {
      id: string
      slug: string
      name: string
      description: string | null
      archived: boolean
      relativePath: string | null
    }
  >
  environments: Map<string, string[]>
  /** Compose projects the panel remembers although nothing runs them. */
  remembered: string[]
  /** Set by the test to prove nothing else was touched. */
  destructiveCalls: string[]
}

function projectDatabase(): { db: Database; store: Store } {
  const store: Store = {
    projects: new Map(),
    environments: new Map(),
    remembered: [],
    destructiveCalls: [],
  }
  let nextId = 1

  const db = {
    status: () => ({ configured: true, available: true, reason: null, checkedAt: 0, migrations: [] }),
    environments: {
      find: async () => null,
      upsertSeen: async () => ({}),
      list: async () => store.remembered.map((composeProject) => ({ composeProject })),
    },
    settings: { listAllEnvironment: async () => [], listAllService: async () => [] },
    projects: {
      create: async (input: {
        slug: string
        name: string
        description: string | null
        relativePath: string | null
      }) => {
        const record = { id: String(nextId++), archived: false, ...input }
        store.projects.set(input.slug, record)
        return record
      },
      update: async (slug: string, patch: Record<string, unknown>) => {
        const record = store.projects.get(slug)
        if (!record) return null
        const updated = { ...record, ...patch }
        store.projects.set(slug, updated)
        return updated
      },
      list: async () => [...store.projects.values()],
      find: async (slug: string) => store.projects.get(slug) ?? null,
      remove: async (slug: string) => {
        store.destructiveCalls.push(`project:${slug}`)
        return store.projects.delete(slug)
      },
      listEnvironments: async () =>
        [...store.environments.entries()].flatMap(([projectId, environments]) =>
          environments.map((composeProject) => ({ projectId, composeProject, source: 'manual' })),
        ),
      setEnvironments: async (projectId: string, environments: string[]) =>
        void store.environments.set(projectId, environments),
      listTags: async () => new Map(),
    },
  }
  return { db: db as unknown as Database, store }
}

function app() {
  const { db, store } = projectDatabase()
  return { ...makeApp({ containers: [...GATEWAY, ...PROJECT_A, ...PROJECT_B] }, {}, db), store }
}

async function put(instance: ReturnType<typeof app>, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

describe('GET/POST /api/projects', () => {
  it('creates a Project that is visible with nothing running', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', {
      slug: 'meu-produto',
      name: 'Meu Produto',
      description: 'The thing we sell',
    })
    expect(created.status).toBe(201)

    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects).toEqual([
      expect.objectContaining({
        slug: 'meu-produto',
        name: 'Meu Produto',
        environmentCount: 0,
        runningEnvironmentCount: 0,
      }),
    ])
  })

  it('refuses a duplicate slug rather than silently reusing one', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'One' })
    const second = await post(instance.app, '/api/projects', { slug: 'meu-produto', name: 'Two' })
    expect(second.status).toBe(409)
  })

  it('answers 503 with a hint when persistence is unavailable', async () => {
    const { app: bare } = makeApp({ containers: [...GATEWAY, ...PROJECT_A] })
    const response = await bare.request('/api/projects')
    expect(response.status).toBe(503)
    expect((await response.json()).hint).toContain('Docker-backed pages remain available')
  })
})

async function putJson(instance: { app: ReturnType<typeof makeApp>['app'] }, path: string, body: unknown) {
  return instance.app.request(path, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
  })
}

const freshDatabase = databasePerFile()

describe('tagging a Project', () => {
  // The real repository on a real SQLite file: tags are a table, and a fake would only agree with itself.
  async function withProject() {
    const { database } = await freshDatabase({ empty: true })
    const instance = makeApp({ containers: [...GATEWAY, ...PROJECT_A] }, {}, database)
    await post(instance.app, '/api/projects', { slug: 'loja', name: 'Loja' })
    return instance
  }

  it('keeps tags with the Project, and lists them', async () => {
    const instance = await withProject()
    const response = await putJson(instance, '/api/projects/loja/tags', {
      tags: [{ key: ' Cliente ', value: ' Acme ' }, { value: 'loja' }],
    })
    expect(response.status).toBe(200)
    expect((await response.json()).tags).toEqual([
      { key: 'cliente', value: 'Acme' },
      { key: '', value: 'loja' },
    ])
    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects[0].tags).toEqual([
      { key: 'cliente', value: 'Acme' },
      { key: '', value: 'loja' },
    ])
    const one = await (await instance.app.request('/api/projects/loja')).json()
    expect(one.tags).toHaveLength(2)
  })

  it('replaces them all, and one tag twice is one', async () => {
    const instance = await withProject()
    await putJson(instance, '/api/projects/loja/tags', { tags: [{ key: 'cliente', value: 'Acme' }] })
    const response = await putJson(instance, '/api/projects/loja/tags', {
      tags: [
        { key: 'cliente', value: 'Globex' },
        { key: 'Cliente', value: 'Globex' },
      ],
    })
    expect((await response.json()).tags).toEqual([{ key: 'cliente', value: 'Globex' }])
    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects[0].tags).toEqual([{ key: 'cliente', value: 'Globex' }])
  })

  it('refuses what is not a label, and what is too many', async () => {
    const instance = await withProject()
    expect((await putJson(instance, '/api/projects/loja/tags', { tags: [{ key: 'a:b', value: 'x' }] })).status).toBe(
      400,
    )
    expect((await putJson(instance, '/api/projects/loja/tags', { tags: [{ value: '   ' }] })).status).toBe(400)
    const many = Array.from({ length: 17 }, (_, index) => ({ value: `t${index}` }))
    expect((await putJson(instance, '/api/projects/loja/tags', { tags: many })).status).toBe(400)
  })

  it('answers 404 for a Project that is not there', async () => {
    const instance = await withProject()
    expect((await putJson(instance, '/api/projects/nope/tags', { tags: [] })).status).toBe(404)
  })

  it('goes with the Project when it is removed', async () => {
    const instance = await withProject()
    await putJson(instance, '/api/projects/loja/tags', { tags: [{ value: 'loja' }] })
    await del(instance.app, '/api/projects/loja')
    await post(instance.app, '/api/projects', { slug: 'loja', name: 'Loja' })
    const list = await (await instance.app.request('/api/projects')).json()
    expect(list.projects[0].tags).toEqual([])
  })
})

describe('placing a Project under Projects Home', () => {
  it('stores a directory under Projects Home, at any depth, and reports it as managed', async () => {
    const instance = app()
    const created = await post(instance.app, '/api/projects', {
      slug: 'produto',
      name: 'Produto',
      relativePath: 'grupo/produto',
    })
    expect(created.status).toBe(201)
    expect(((await created.json()) as Project).location).toBe('managed')
  })

  it('refuses an absolute path, a parent reference or a hidden directory', async () => {
    const instance = app()
    for (const relativePath of ['/srv/projects/produto', '../produto', 'a/../../b', '.hidden/x']) {
      const response = await post(instance.app, '/api/projects', {
        slug: `p-${relativePath.length}`,
        name: 'P',
        relativePath,
      })
      expect(response.status, relativePath).toBe(400)
    }
  })
})

describe('adopting environments', () => {
  it('adopts by hand, and says the mapping was manual', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['alpha'],
    })
    const body = (await response.json()) as Project
    expect(body.environments).toEqual([
      expect.objectContaining({ environment: 'alpha', source: 'manual', running: true }),
    ])
  })

  it('adopts an environment the panel remembers although nothing runs it', async () => {
    const instance = app()
    instance.store.remembered.push('stopped-stack')
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['stopped-stack'],
    })
    expect(response.status).toBe(200)
    expect(instance.store.environments.get('1')).toEqual(['stopped-stack'])
  })

  it('refuses an environment that is neither running nor remembered', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    const response = await put(instance, '/api/projects/produto/environments', {
      environments: ['ghost'],
    })
    expect(response.status).toBe(400)
  })
})

describe('deleting a Project', () => {
  it('removes the grouping and nothing else', async () => {
    const instance = app()
    await post(instance.app, '/api/projects', { slug: 'produto', name: 'Produto' })
    await put(instance, '/api/projects/produto/environments', { environments: ['alpha'] })

    const response = await del(instance.app, '/api/projects/produto')
    expect(response.status).toBe(200)
    expect((await response.json()).note).toContain('no container, volume or environment')

    // Nothing was stopped or removed on the Docker side.
    expect(instance.docker.removed).toEqual([])
    expect(instance.docker.calls.filter((call) => ['stop', 'remove'].includes(call.method))).toEqual([])

    // And the environment is still exactly where it was.
    const runtimes = await (await instance.app.request('/api/environments')).json()
    expect(runtimes.environments.map((environment: { name: string }) => environment.name)).toContain('alpha')
  })

  it('404s a Project that does not exist', async () => {
    const instance = app()
    expect((await del(instance.app, '/api/projects/ghost')).status).toBe(404)
  })
})
