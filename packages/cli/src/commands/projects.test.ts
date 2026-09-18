import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Output } from '../output.js'

const mocks = vi.hoisted(() => ({
  inspectContainers: vi.fn(),
  runProcess: vi.fn(),
  confirm: vi.fn(),
  root: '/portta',
}))
vi.mock('../docker.js', () => ({ inspectContainers: mocks.inspectContainers }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))
vi.mock('../confirm.js', () => ({ confirm: mocks.confirm }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: {},
    config: { domain: 'localhost', network: 'portta', projectName: 'portta' },
    composeFiles: [],
    version: 'test',
  }),
}))

import { analyzeCommand, initCommand, overlayNetworks } from './projects.js'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.inspectContainers.mockReset()
  mocks.runProcess.mockReset()
  mocks.confirm.mockReset()
  mocks.root = '/portta'
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function temp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'portta-analyze-')))
  dirs.push(dir)
  return dir
}

const COMPOSE =
  'services:\n  web:\n    image: nginx\n    container_name: shop-web\n    ports:\n      - "8080:80"\n  db:\n    image: postgres\n'

/** What `docker compose config --format json` prints: always a resolved `name`, and `default` for a service that names no network. */
function composeConfig(name: string, webNetworks: Record<string, unknown> = { default: null }) {
  return {
    exitCode: 0,
    stdout: JSON.stringify({
      name,
      services: {
        web: {
          image: 'nginx',
          container_name: 'shop-web',
          ports: [{ target: 80, published: '8080' }],
          networks: webNetworks,
        },
        db: { image: 'postgres' },
      },
    }),
    stderr: '',
  }
}

function container(name: string, labels: Record<string, string>, state = 'running') {
  return { id: name, name, image: 'x', state, labels, ports: [], networks: [], health: null, mounts: [] }
}

const command = { optsWithGlobals: () => ({ json: true }) } as never

async function report(path: string, options: { file?: string } = {}): Promise<Record<string, any>> {
  let stdout = ''
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk)
    return true
  })
  await analyzeCommand(path, options, command)
  return JSON.parse(stdout).data
}

describe('portta analyze', () => {
  it('reads the usual file, and says what collides on the host', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue(composeConfig('shop'))
    mocks.inspectContainers.mockResolvedValue([
      container('shop-web', {
        'com.docker.compose.project': 'other',
        'com.docker.compose.project.working_dir': '/elsewhere/other',
      }),
      container('shop-db-1', {
        'com.docker.compose.project': 'shop',
        'com.docker.compose.project.working_dir': '/elsewhere/shop',
      }),
      container(
        'shop-db-2',
        { 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': dir },
        'exited',
      ),
    ])

    const result = await report(dir)
    expect(result.path).toBe(dir)
    expect(result.compose_file).toBe('compose.yaml')
    expect(result.project).toEqual({ name: 'shop', source: 'directory name (implicit)' })
    expect(mocks.runProcess.mock.calls[0]![1]).toEqual([
      'compose',
      '-f',
      join(dir, 'compose.yaml'),
      'config',
      '--format',
      'json',
    ])
    expect(result.findings).toMatchObject({
      fixed_container_names: ['web'],
      implicit_namespace: true,
      container_name_collisions: [
        { service: 'web', container_name: 'shop-web', used_by: 'Compose project other', state: 'running' },
      ],
      // The container in this very directory is the project itself, not a second checkout.
      namespace_in_use: { project: 'shop', working_dirs: ['/elsewhere/shop'] },
      name_without_env: null,
    })
  })

  it('names a container outside Compose, and stays quiet when nothing collides', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    writeFileSync(join(dir, '.env'), 'COMPOSE_PROJECT_NAME=shop\n')
    mocks.runProcess.mockResolvedValue(composeConfig('shop'))
    mocks.inspectContainers.mockResolvedValue([container('shop-web', {})])
    const result = await report(dir)
    expect(result.project).toEqual({ name: 'shop', source: '.env' })
    expect(result.findings.container_name_collisions).toEqual([
      { service: 'web', container_name: 'shop-web', used_by: 'a container outside Compose', state: 'running' },
    ])
    expect(result.findings.namespace_in_use).toBeNull()
    expect(result.findings.implicit_namespace).toBe(false)

    mocks.inspectContainers.mockResolvedValue([])
    const quiet = await report(dir)
    expect(quiet.findings.container_name_collisions).toEqual([])
  })

  it('warns about a top-level name: that .env does not pin', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), `name: loja\n${COMPOSE}`)
    mocks.runProcess.mockResolvedValue(composeConfig('loja'))
    mocks.inspectContainers.mockResolvedValue([])
    const result = await report(dir)
    expect(result.project).toEqual({ name: 'loja', source: 'compose name:' })
    expect(result.findings).toMatchObject({ implicit_namespace: false, name_without_env: 'loja' })

    writeFileSync(join(dir, '.env'), 'COMPOSE_PROJECT_NAME=loja\n')
    expect((await report(dir)).findings.name_without_env).toBeNull()
  })

  it('still reports when Docker cannot be asked', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue(composeConfig('shop'))
    mocks.inspectContainers.mockRejectedValue(new Error('no docker'))
    const result = await report(dir)
    expect(result.findings.container_name_collisions).toEqual([])
    expect(result.findings.namespace_in_use).toBeNull()
  })

  it('takes --file, relative or absolute, and makes its directory the project', async () => {
    const dir = temp()
    mkdirSync(join(dir, 'deploy'))
    writeFileSync(join(dir, 'deploy', 'stack.yaml'), COMPOSE)
    writeFileSync(join(dir, 'deploy', '.env'), 'COMPOSE_PROJECT_NAME=deployed\n')
    mocks.runProcess.mockResolvedValue(composeConfig('deployed'))
    mocks.inspectContainers.mockResolvedValue([])

    const relative = await report(dir, { file: 'deploy/stack.yaml' })
    expect(relative.path).toBe(join(dir, 'deploy'))
    expect(relative.compose_file).toBe('stack.yaml')
    expect(relative.project).toEqual({ name: 'deployed', source: '.env' })
    expect(mocks.runProcess.mock.calls[0]![1]).toContain(join(dir, 'deploy', 'stack.yaml'))
    expect(mocks.runProcess.mock.calls[0]![2]).toMatchObject({ cwd: join(dir, 'deploy') })

    const absolute = await report('/nowhere', { file: join(dir, 'deploy', 'stack.yaml') })
    expect(absolute.path).toBe(join(dir, 'deploy'))

    await expect(report(dir, { file: 'missing.yaml' })).rejects.toThrow(/no Compose file at/)
  })
})

describe('portta analyze reads .portta/project.yaml', () => {
  const analyzeWith = async (contents: string | null) => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    if (contents !== null) {
      mkdirSync(join(dir, '.portta'), { recursive: true })
      writeFileSync(join(dir, '.portta', 'project.yaml'), contents)
    }
    mocks.runProcess.mockResolvedValue(composeConfig('shop'))
    mocks.inspectContainers.mockResolvedValue([])
    return (await report(dir)).project_config
  }

  it('reports the defaults when the project declares nothing', async () => {
    const declared = await analyzeWith(null)
    expect(declared.source).toBe('defaults')
    expect(declared.issues).toEqual([])
    expect(declared.config.worktrees).toEqual({ root: '.portta/worktrees', branchPattern: '{type}/{slug}' })
    expect(declared.config.name).toBeNull()
  })

  it('reports what the project declared', async () => {
    const declared = await analyzeWith('version: 1\nname: demo-shop\nmainBranch: develop\nstack: [node]\n')
    expect(declared.source).toBe('file')
    expect(declared.issues).toEqual([])
    expect(declared.config.name).toBe('demo-shop')
    expect(declared.config.mainBranch).toBe('develop')
    expect(declared.config.stack).toEqual(['node'])
  })

  it('reports a host-shaped value as an issue instead of applying it', async () => {
    const declared = await analyzeWith('version: 1\ndomain: example.com\n')
    expect(declared.config).toBeNull()
    expect(declared.issues.map((issue: { message: string }) => issue.message).join('\n')).toContain('domain')
  })

  it('reports malformed YAML without aborting the rest of the report', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mkdirSync(join(dir, '.portta'), { recursive: true })
    writeFileSync(join(dir, '.portta', 'project.yaml'), 'version: 1\n  bad: [indent\n')
    mocks.runProcess.mockResolvedValue(composeConfig('shop'))
    mocks.inspectContainers.mockResolvedValue([])

    const result = await report(dir)
    expect(result.project_config.config).toBeNull()
    expect(result.project_config.issues.length).toBeGreaterThan(0)
    expect(result.compose_file).toBe('compose.yaml')
  })
})

describe('portta init', () => {
  it('stores a validated overlay outside the Compose project named with --file', async () => {
    const dir = temp()
    mkdirSync(join(dir, 'deploy'))
    writeFileSync(join(dir, 'deploy', 'stack.yaml'), COMPOSE)
    mocks.root = join(dir, 'portta-runtime')
    mocks.runProcess.mockResolvedValue(composeConfig('deploy'))
    mocks.confirm.mockResolvedValue(undefined)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await initCommand(dir, { file: 'deploy/stack.yaml' }, { optsWithGlobals: () => ({ yes: true }) } as never)
    const overlayPath = readdirSync(join(mocks.root, 'runtime', 'compose'), { recursive: true, encoding: 'utf8' }).find(
      (entry) => entry.endsWith('compose.portta.yaml'),
    )
    expect(overlayPath).toBeDefined()
    const overlay = readFileSync(join(mocks.root, 'runtime', 'compose', overlayPath!), 'utf8')
    expect(overlay).toContain('${COMPOSE_PROJECT_NAME:-deploy}-web')
    expect(overlay).toContain('    ports: !reset []\n    networks:\n      - default\n      - portta\n')
    expect(existsSync(join(dir, 'deploy', 'compose.portta.yaml'))).toBe(false)
    expect(mocks.inspectContainers).not.toHaveBeenCalled()
    expect(new Output({ json: true }).json).toBe(true)
  })

  it('emits the logical Project label only when --project names a valid slug', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue(composeConfig('shop-pr42'))
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })

    await initCommand(dir, { dryRun: true, project: 'shop' }, { optsWithGlobals: () => ({}) } as never)
    expect(stdout).toContain('      - "portta.project=shop"')

    await expect(
      initCommand(dir, { dryRun: true, project: '../shop' }, { optsWithGlobals: () => ({}) } as never),
    ).rejects.toThrow(/invalid --project value/)
  })

  it('does not route a worker merely because it uses a web runtime image', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        name: 'shop',
        services: { 'queue-worker': { image: 'node:24-alpine' }, web: { image: 'nginx', expose: [80] } },
      }),
      stderr: '',
    })
    mocks.inspectContainers.mockResolvedValue([])

    const result = await report(dir)
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'queue-worker', kind: 'worker' }),
        expect.objectContaining({ name: 'web', kind: 'http' }),
      ]),
    )
  })

  it('autodetects with Commander’s empty --service default and selects known console ports', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        name: 'shop',
        services: {
          mailpit: { image: 'axllent/mailpit:latest' },
          rustfs: { image: 'rustfs/rustfs:latest' },
          'rustfs-init': { image: 'minio/mc:latest' },
        },
      }),
      stderr: '',
    })
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })

    await initCommand(dir, { dryRun: true, service: [] }, { optsWithGlobals: () => ({}) } as never)
    expect(stdout).toContain('${COMPOSE_PROJECT_NAME:-shop}-mailpit.loadbalancer.server.port=8025')
    expect(stdout).toContain('${COMPOSE_PROJECT_NAME:-shop}-rustfs.loadbalancer.server.port=9001')
    expect(stdout).not.toContain('-rustfs-init.loadbalancer')
  })

  it('keeps the networks a service already declares, and adds portta only', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'compose.yaml'), COMPOSE)
    mocks.runProcess.mockResolvedValue(composeConfig('base', { baseempresarial: null, backend: { aliases: ['web'] } }))
    let stdout = ''
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk)
      return true
    })

    await initCommand(dir, { dryRun: true }, { optsWithGlobals: () => ({}) } as never)
    expect(stdout).toContain(
      '  web:\n    ports: !reset []\n    networks:\n      - baseempresarial\n      - backend\n      - portta\n',
    )
    expect(stdout).not.toContain('- default')

    stdout = ''
    await initCommand(dir, { dryRun: true, service: ['db:5432'] }, { optsWithGlobals: () => ({}) } as never)
    expect(stdout).toContain('  db:\n    ports: !reset []\n    networks:\n      - default\n      - portta\n')
  })
})

describe('overlayNetworks', () => {
  it('never doubles portta and falls back to default', () => {
    expect(overlayNetworks([])).toEqual(['default', 'portta'])
    expect(overlayNetworks(['default'])).toEqual(['default', 'portta'])
    expect(overlayNetworks(['portta'])).toEqual(['default', 'portta'])
    expect(overlayNetworks(['app', 'portta'])).toEqual(['app', 'portta'])
  })
})
