import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requests: [] as { method: string; url: string; body: unknown; authorization?: string }[],
  root: '/tmp/portta',
  home: '/tmp/portta-demo',
  runProcess: vi.fn(),
}))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: { PORTTA_WEB_PORT: '8081', PORTTA_TOKEN: 'ptt_secret', PORTTA_PROJECTS_HOME: mocks.home, HOME: '/tmp' },
    config: {},
    composeFiles: [],
    version: 'test',
  }),
}))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))

import { DEV_DEMO_OWNER } from 'portta-core'
import {
  demoComposeArgs,
  demoHome,
  ensureDevDemoOwner,
  findDemoStacks,
  readDemoProject,
  registerDemoProjects,
  requireDemoStacks,
  waitForPanel,
} from './demo.ts'

function command(globals: Record<string, unknown> = {}): Command {
  return { optsWithGlobals: () => ({ json: true, ...globals }) } as unknown as Command
}

const homes: string[] = []

function demoProjectsHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'portta-demo-home-'))
  homes.push(home)
  mocks.home = home
  for (const name of ['a', 'b', 'external', 'monorepo', 'shop', 'site']) {
    const directory = join(home, `portta-demo-${name}`)
    mkdirSync(directory)
    writeFileSync(join(directory, 'compose.yaml'), `name: demo-${name}\nservices: {}\n`)
    if (name !== 'external') {
      mkdirSync(join(directory, '.portta'))
      writeFileSync(join(directory, '.portta', 'compose.portta.yaml'), 'services: {}\n')
    }
  }
  mkdirSync(join(home, 'ordinary-project'))
  writeFileSync(join(home, 'ordinary-project', 'compose.yaml'), 'services: {}\n')
  return home
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mocks.requests.length = 0
  mocks.root = '/tmp/portta'
  mocks.home = '/tmp/portta-demo'
  mocks.runProcess.mockReset()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('demo stacks', () => {
  it('discovers every portta-demo-* Compose project under Projects Home', () => {
    const home = demoProjectsHome()
    const names = findDemoStacks(home).map((stack) => stack.name)
    expect(names).toEqual([
      'portta-demo-a',
      'portta-demo-b',
      'portta-demo-external',
      'portta-demo-monorepo',
      'portta-demo-shop',
      'portta-demo-site',
    ])
    expect(names.some((name) => name.includes('ordinary-project'))).toBe(false)
    expect(demoHome(command())).toBe(home)
  })

  // --demo on a checkout whose Projects Home has no examples must not start
  // the gateway and quietly start nothing; it has to say where it looked.
  it('refuses --demo with the path it searched when no example exists', () => {
    const home = mkdtempSync(join(tmpdir(), 'portta-demo-empty-'))
    homes.push(home)
    mocks.home = home
    expect(() => requireDemoStacks(command())).toThrow(new RegExp(`no portta-demo-\\* Compose project in ${home}`))
  })

  it('uses the Portta overlay when it exists, and compose.yaml alone when it does not', () => {
    const stacks = Object.fromEntries(findDemoStacks(demoProjectsHome()).map((stack) => [stack.name, stack]))
    expect(stacks['portta-demo-a']).toMatchObject({
      overlay: true,
      files: ['compose.yaml', '.portta/compose.portta.yaml'],
    })
    expect(stacks['portta-demo-external']).toMatchObject({ overlay: false, files: ['compose.yaml'] })
    expect(demoComposeArgs(stacks['portta-demo-a']!, 'up')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      '-f',
      '.portta/compose.portta.yaml',
      'up',
      '-d',
    ])
    expect(demoComposeArgs(stacks['portta-demo-external']!, 'down')).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      'down',
      '-v',
    ])
  })
})

describe('demo Projects', () => {
  // The environments --demo starts belong to a Project only if one exists;
  // a second run finds the first run's Projects and must not fail on them.
  it('registers the Project each example declares, and treats an existing one as done', async () => {
    const home = demoProjectsHome()
    writeFileSync(
      join(home, 'portta-demo-shop', '.portta', 'portta.example.json'),
      JSON.stringify({
        project: {
          slug: 'demo-shop',
          name: 'Demo Shop',
          description: 'Example shop.',
          relativePath: 'portta-demo-shop',
        },
        repositories: [{ key: 'shop', name: 'portta-demo-shop', role: 'web', relativePath: 'portta-demo-shop' }],
      }),
    )
    writeFileSync(
      join(home, 'portta-demo-site', '.portta', 'portta.example.json'),
      JSON.stringify({
        project: { slug: 'demo-site', name: 'Demo Site' },
      }),
    )
    writeFileSync(join(home, 'portta-demo-a', '.portta', 'portta.example.json'), 'not json')
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      mocks.requests.push({ method: init?.method ?? 'GET', url, body })
      return new Response('{}', { status: body?.slug === 'demo-site' ? 409 : 201 })
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(readDemoProject(join(home, 'portta-demo-a'))).toBeNull()
    await registerDemoProjects(command(), findDemoStacks(home))

    expect(mocks.requests.map((request) => request.body)).toEqual([
      { slug: 'demo-shop', name: 'Demo Shop', description: 'Example shop.', relativePath: 'portta-demo-shop' },
      { name: 'portta-demo-shop', role: 'web', relativePath: 'portta-demo-shop' },
      { slug: 'demo-site', name: 'Demo Site', description: null, relativePath: 'portta-demo-site' },
    ])
    expect(mocks.requests[1]?.url).toContain('/projects/demo-shop/repositories')
  })
})

describe('the development owner', () => {
  it('creates it on a protected panel and mints the token the rest of the run uses', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      mocks.requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (String(url).includes('/auth/status')) {
        return new Response(JSON.stringify({ mode: 'protected', setupRequired: true }), { status: 200 })
      }
      if (method === 'POST' && String(url).includes('/auth/setup')) {
        return new Response(
          JSON.stringify({ ok: true, user: { id: 'u1', email: DEV_DEMO_OWNER.email, name: DEV_DEMO_OWNER.name } }),
          { status: 201 },
        )
      }
      if (method === 'POST' && String(url).includes('/sign-in/email')) {
        return new Response('{}', { status: 200, headers: { 'set-cookie': 'portta.session_token=demo; Path=/' } })
      }
      if (method === 'POST' && String(url).includes('/auth/tokens')) {
        return new Response(JSON.stringify({ token: 'ptt_demo' }), { status: 201 })
      }
      return new Response('{}', { status: 200 })
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const token = await ensureDevDemoOwner(command())

    expect(
      mocks.requests.find((request) => request.method === 'POST' && String(request.url).includes('/auth/setup'))?.body,
    ).toEqual({ name: 'Admin Demo', email: 'admin@admin.com', password: 'secret' })
    expect(token).toBe('ptt_demo')
  })

  // An installation never gets these credentials: an open panel has no owner to
  // create, and posting one would seed a well-known password into it.
  it('creates nothing on an open panel', async () => {
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      mocks.requests.push({ method: init?.method ?? 'GET', url, body: undefined })
      return new Response(JSON.stringify({ mode: 'open', setupRequired: false }), { status: 200 })
    })
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(await ensureDevDemoOwner(command())).toBeUndefined()
    expect(mocks.requests.every((request) => String(request.url).includes('/auth/status'))).toBe(true)
  })
})

describe('waiting for the panel', () => {
  it('times out instead of hanging when the panel never answers', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(waitForPanel(command(), 0)).rejects.toThrow(/did not become reachable/)
  })
})
