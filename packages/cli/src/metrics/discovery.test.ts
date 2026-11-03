import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileKey } from 'portta-core'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../commands/projects.js', () => ({
  analyze: vi.fn(async (path: string) => ({
    path,
    compose_file: 'compose.yaml',
    gateway_overlay: null,
    project: { name: 'loja-nova', source: 'directory name (implicit)' },
    domain: 'portta.example',
    services: [
      {
        name: 'web',
        image: 'nginx',
        kind: 'http',
        container_name: null,
        published_ports: [],
        container_ports: ['3000'],
        expose: [],
      },
      {
        name: 'postgres',
        image: 'postgres',
        kind: 'datastore',
        container_name: 'loja-db',
        published_ports: [{ host: '5432', container: '5432' }],
        container_ports: [],
        expose: [],
      },
    ],
    findings: {
      published_host_ports: ['postgres'],
      fixed_container_names: ['postgres'],
      published_datastores: ['postgres'],
      implicit_namespace: true,
      container_name_collisions: [],
      namespace_in_use: null,
    },
  })),
}))

const { discoveryDir, findComposeFolders, isWalkableHome, publishDiscovery, reachesOut } = await import(
  './discovery.js'
)

function home() {
  const root = mkdtempSync(join(tmpdir(), 'portta-discovery-root-'))
  const projects = mkdtempSync(join(tmpdir(), 'portta-discovery-home-'))
  writeFileSync(join(root, '.env'), `PORTTA_PROJECTS_HOME=${projects}\n`)
  for (const dir of ['loja-nova', 'clientes/acme/site', '.hidden', 'node_modules/pkg', 'a/b/c/d']) {
    mkdirSync(join(projects, dir), { recursive: true })
    writeFileSync(join(projects, dir, 'compose.yaml'), 'services: {}\n')
  }
  return { root, projects }
}

describe('finding project folders', () => {
  it('lists the folders with a Compose file, at most three levels down, and skips hidden ones and dependencies', () => {
    const { projects } = home()
    expect(findComposeFolders(projects).map((folder) => folder.path)).toEqual(
      ['clientes/acme/site', 'loja-nova'].sort(),
    )
  })

  it('does not follow a link out of Projects Home', () => {
    const { projects } = home()
    const outside = mkdtempSync(join(tmpdir(), 'portta-discovery-outside-'))
    writeFileSync(join(outside, 'compose.yaml'), 'services: {}\n')
    symlinkSync(outside, join(projects, 'escape'))
    expect(findComposeFolders(projects).map((folder) => folder.path)).not.toContain('escape')
  })
})

describe('publishing what was found', () => {
  it('writes the folders and a plan for each, by a name made from the path', async () => {
    const { root } = home()
    await publishDiscovery(root, Date.now())
    const base = discoveryDir(root)
    const index = JSON.parse(readFileSync(join(base, 'folders.json'), 'utf8'))
    expect(index.folders.map((folder: { path: string }) => folder.path)).toEqual(['clientes/acme/site', 'loja-nova'])
    expect(index.folders[1]).toMatchObject({ services: 2, adopted: false, planned: true })
    const plan = JSON.parse(readFileSync(join(base, 'plans', fileKey('loja-nova')), 'utf8'))
    expect(plan.services[0]).toMatchObject({ name: 'web', kind: 'http', port: '3000' })
    expect(plan.findings).toMatchObject({ publishedDatastores: ['postgres'], implicitNamespace: true })
  })

  it('publishes nothing when Projects Home is not there', async () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-discovery-nohome-'))
    writeFileSync(join(root, '.env'), `PORTTA_PROJECTS_HOME=${join(root, 'missing')}\n`)
    await publishDiscovery(root)
    expect(existsSync(join(discoveryDir(root), 'folders.json'))).toBe(false)
  })
})

describe('what the collector will walk and read on its own', () => {
  it.each(['/', '/home', '/etc', '/etc/portta', '/root', '/proc/1', '/var/lib/docker/volumes'])(
    'will not walk %s as Projects Home',
    (home) => expect(isWalkableHome(home)).toBe(false),
  )

  it.each(['/srv/projects', '/home/ada/projects', '/Users/ada/Projects'])('walks %s', (home) =>
    expect(isWalkableHome(home)).toBe(true),
  )

  it('does not analyse a Compose file that makes Compose fetch something', () => {
    expect(reachesOut('include:\n  - oci://registry.example/stack:1\n')).toBe(true)
    expect(reachesOut('include:\n  - git+https://github.com/acme/stack.git\n')).toBe(true)
    expect(reachesOut('services:\n  web:\n    extends:\n      file: https://example.com/base.yml\n')).toBe(true)
    expect(reachesOut('services:\n  web:\n    image: nginx\n    ports: ["8080:80"]\n')).toBe(false)
  })

  it('lists such a folder and publishes no plan for it', async () => {
    const { root, projects } = home()
    mkdirSync(join(projects, 'remoto'))
    writeFileSync(join(projects, 'remoto', 'compose.yaml'), 'include:\n  - oci://registry.example/stack:1\n')
    await publishDiscovery(root, Date.now())
    const index = JSON.parse(readFileSync(join(discoveryDir(root), 'folders.json'), 'utf8'))
    const named = (path: string) => index.folders.find((folder: { path: string }) => folder.path === path)
    expect(named('remoto')).toMatchObject({ planned: false })
    expect(named('loja-nova')).toMatchObject({ planned: true })
  })
})
