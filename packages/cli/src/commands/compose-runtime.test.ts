import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ContainerRecord, hostLabel, readProtectionStore } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  root: '',
  profile: 'local',
  domain: 'apps.example.test',
  containers: [] as ContainerRecord[],
  volumes: [] as string[],
  runProcess: vi.fn(),
}))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({
    root: mocks.root,
    env: {},
    config: { network: 'portta', profile: mocks.profile, domain: mocks.domain, tlsEnabled: true },
    composeFiles: [],
    version: 'test',
  }),
}))
vi.mock('../process.js', () => ({
  runProcess: (file: string, args: string[], ...options: unknown[]) =>
    args[0] === 'volume'
      ? Promise.resolve({ exitCode: 0, stdout: mocks.volumes.join('\n'), stderr: '', failed: false })
      : mocks.runProcess(file, args, ...options),
}))
vi.mock('../docker.js', () => ({ inspectContainers: vi.fn(async () => mocks.containers) }))

import { adoptComposeRuntime, initComposeRuntime, prepareComposeRuntime, runtimeAction } from './compose-runtime.js'

const roots: string[] = []
afterEach(() => {
  mocks.profile = 'local'
  mocks.domain = 'apps.example.test'
  mocks.containers = []
  mocks.volumes = []
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mocks.runProcess.mockReset()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function temp(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'portta-runtime-')))
  roots.push(root)
  return root
}
const command = { optsWithGlobals: () => ({ quiet: true }) } as never
const sourceModel = {
  name: 'ignored',
  services: {
    web: { image: 'nginx', ports: [{ target: 3000, published: '3000' }], networks: { backend: { aliases: ['web'] } } },
    postgres: { image: 'postgres', ports: [{ target: 5432, published: '5432' }] },
  },
}
const finalModel = {
  services: { web: { image: 'nginx', networks: { backend: {}, portta: {} } }, postgres: { image: 'postgres' } },
}
function result(stdout: unknown) {
  return {
    exitCode: 0,
    stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout),
    stderr: '',
    failed: false,
  }
}

describe('Compose runtime', () => {
  it('requires Compose 2.24.4 because auto overlays use !reset', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockResolvedValue(result('2.24.3'))
    await expect(prepareComposeRuntime({ path: workspace }, command)).rejects.toThrow(/2.24.4/)
  })

  it('accepts a newer Compose major version and prepares a data-only environment privately', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version') ? result('5.1.2') : result({ services: {} }),
    )
    const plan = await prepareComposeRuntime({ path: workspace }, command)
    expect(plan.outcome).toBe('isolated')
    expect(plan.services).toEqual([])
  })

  it('routes a built storefront with one declared port without relying on its image name', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      services: {
        storefront: { ports: [{ target: 3000, published: '80' }] },
        worker: { ports: [{ target: 3000, published: '3001' }] },
      },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { storefront: {}, worker: {} } })
            : result(model),
    )

    const plan = await prepareComposeRuntime({ path: workspace }, command)
    expect(plan.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'storefront', route: 'http', containerPort: 3000 }),
        expect.objectContaining({ name: 'worker', route: 'none' }),
      ]),
    )
  })

  it('keeps the Base Eleições datastore-only pattern private after each fixed container name is explicitly accepted', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'docker-compose.yaml'), 'services: {}\n')
    const model = {
      services: {
        postgres: {
          image: 'ghcr.io/brasildatahub/postgres:17',
          container_name: 'el-postgres',
          ports: [{ target: 5432, published: '5442' }],
        },
        opensearch: {
          image: 'ghcr.io/brasildatahub/opensearch:3',
          container_name: 'el-opensearch',
          ports: [{ target: 9200, published: '9250' }],
        },
        redis: {
          image: 'ghcr.io/brasildatahub/redis:7',
          container_name: 'el-redis',
          ports: [{ target: 6379, published: '6389' }],
        },
      },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { postgres: {}, opensearch: {}, redis: {} } })
            : result(model),
    )

    const preview = await adoptComposeRuntime({ path: workspace, dryRun: true }, command)
    expect(preview.outcome).toBe('not_supported')
    expect(preview.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'container_name', service: 'postgres' }),
        expect.objectContaining({ code: 'container_name', service: 'opensearch' }),
        expect.objectContaining({ code: 'container_name', service: 'redis' }),
      ]),
    )

    const plan = await adoptComposeRuntime(
      { path: workspace, removeContainerName: ['postgres', 'opensearch', 'redis'] },
      command,
    )
    expect(plan.outcome).toBe('isolated')
    expect(plan.services.every((service) => service.route === 'none')).toBe(true)
    expect(readFileSync(plan.compose.generatedOverlay, 'utf8')).toContain('container_name: !reset null')
  })

  it('requires and records the Base Empresarial fixed-network decision while preserving its private services', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      services: {
        app: {
          image: 'dunglas/frankenphp',
          ports: [{ target: 8000, published: '8000' }],
          volumes: ['./:/var/www/html'],
          networks: { default: null, baseempresarial: null },
        },
        worker: {
          image: 'dunglas/frankenphp',
          volumes: ['./:/var/www/html'],
          networks: { default: null, baseempresarial: null },
        },
        pgsql: { image: 'postgres:18-alpine', ports: [{ target: 5432, published: '5432' }] },
        rustfs: {
          image: 'rustfs/rustfs',
          ports: [
            { target: 9000, published: '9000' },
            { target: 9001, published: '9001' },
          ],
        },
        mailpit: {
          image: 'axllent/mailpit',
          ports: [
            { target: 1025, published: '1025' },
            { target: 8025, published: '8025' },
          ],
        },
      },
      networks: { baseempresarial: { name: 'baseempresarial' } },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { app: {}, worker: {}, pgsql: {}, rustfs: {}, mailpit: {} } })
            : result(model),
    )

    const preview = await adoptComposeRuntime({ path: workspace, project: 'base-empresarial', dryRun: true }, command)
    expect(preview.outcome).toBe('not_supported')
    expect(preview.pending).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'shared_network' })]))

    const plan = await adoptComposeRuntime(
      { path: workspace, project: 'base-empresarial', allowSharedNetworks: true },
      command,
    )
    expect(plan.outcome).toBe('isolated')
    expect(plan.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'app', route: 'http', containerPort: 8000 }),
        expect.objectContaining({ name: 'worker', route: 'none' }),
        expect.objectContaining({ name: 'pgsql', route: 'none' }),
        expect.objectContaining({ name: 'rustfs', route: 'none' }),
        expect.objectContaining({ name: 'mailpit', route: 'none' }),
      ]),
    )
    expect(plan.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'bind_mount', service: 'app' })]),
    )
  })

  it('isolates the Video Producer API and web surfaces only after its fixed networks are explicitly accepted', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      services: {
        postgres: {
          image: 'postgres:17-alpine',
          volumes: ['./docker/volumes/postgres:/var/lib/postgresql/data'],
          networks: { internal: null },
        },
        api: {
          image: 'video-producer/api:local',
          ports: [{ target: 8000, published: '8000' }],
          volumes: ['./storage:/app/storage'],
          networks: { internal: null, edge: null },
        },
        worker: {
          image: 'video-producer/worker:local',
          volumes: ['./storage:/app/storage'],
          networks: { internal: null },
        },
        web: {
          image: 'video-producer/web:local',
          ports: [{ target: 5173, published: '5173' }],
          networks: { edge: null },
        },
      },
      networks: { internal: { name: 'video-producer-internal' }, edge: { name: 'video-producer-edge' } },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { postgres: {}, api: {}, worker: {}, web: {} } })
            : result(model),
    )

    const plan = await adoptComposeRuntime(
      { path: workspace, project: 'video-producer', allowSharedNetworks: true },
      command,
    )
    expect(plan.outcome).toBe('isolated')
    expect(plan.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'api', route: 'http', containerPort: 8000 }),
        expect.objectContaining({ name: 'web', route: 'http', containerPort: 5173 }),
        expect.objectContaining({ name: 'postgres', route: 'none' }),
        expect.objectContaining({ name: 'worker', route: 'none' }),
      ]),
    )
    const generated = readFileSync(plan.compose.generatedOverlay, 'utf8')
    expect(generated).toContain('ports: !reset []')
    expect(generated).toContain('video-producer-api.loadbalancer.server.port=8000')
    expect(generated).toContain('video-producer-web.loadbalancer.server.port=5173')
  })

  it('persists a validated plan and derived overlay outside the source project', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n')
    writeFileSync(join(workspace, 'compose.dev.yaml'), 'services: {}\n')
    writeFileSync(join(workspace, '.env'), 'COMPOSE_FILE=compose.yaml:compose.dev.yaml\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )

    const plan = await prepareComposeRuntime({ path: workspace }, command)

    expect(plan.compose.files).toEqual([join(workspace, 'compose.yaml'), join(workspace, 'compose.dev.yaml')])
    expect(plan.compose.projectName).toMatch(/^portta-runtime-/)
    expect(existsSync(plan.compose.generatedOverlay)).toBe(true)
    expect(existsSync(join(workspace, 'compose.portta.yaml'))).toBe(false)
    expect(readFileSync(plan.compose.generatedOverlay, 'utf8')).toContain('ports: !reset []')
    expect(readFileSync(plan.compose.generatedOverlay, 'utf8')).toContain('backend\n      - portta')
    const generated = readFileSync(plan.compose.generatedOverlay, 'utf8')
    expect(generated).toContain('traefik.http.services.')
    expect(generated).not.toContain('traefik.http.routers.')
    expect(generated).not.toContain('Host(')
    expect(
      mocks.runProcess.mock.calls.some(
        ([, args]) => args.includes('--project-directory') && args.includes(join(workspace, 'compose.dev.yaml')),
      ),
    ).toBe(true)
  })

  it.each([
    ['docker-compose.yml', 'docker-compose.override.yml'],
    ['docker-compose.yaml', 'docker-compose.override.yaml'],
    ['compose.yaml', 'compose.override.yaml'],
    ['compose.yml', 'compose.override.yml'],
    // Accepted before the pairing existed, so a project that mixes the two families keeps its override.
    ['docker-compose.yml', 'compose.override.yaml'],
  ])('loads %s together with the %s Compose itself would load', async (base, override) => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, base), 'services:\n  web:\n    image: nginx\n')
    writeFileSync(join(workspace, override), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )

    const plan = await prepareComposeRuntime({ path: workspace }, command)

    expect(plan.compose.files).toEqual([join(workspace, base), join(workspace, override)])
  })

  it('uses configured profiles while validating the source model', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n')
    mkdirSync(join(workspace, '.portta'))
    writeFileSync(
      join(workspace, '.portta', 'runtime.json'),
      JSON.stringify({ schemaVersion: 1, compose: { profiles: ['preview'] } }),
    )
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )

    await prepareComposeRuntime({ path: workspace }, command)

    const sourceConfig = mocks.runProcess.mock.calls.find(
      ([, args]) => args.includes('config') && !args.some((arg: string) => arg.endsWith('.tmp')),
    )?.[1] as string[]
    expect(sourceConfig).toEqual(expect.arrayContaining(['--profile', 'preview']))
  })

  it('stores init intent and its overlay outside the source project', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    const source = 'services:\n  web:\n    image: nginx\n'
    writeFileSync(join(workspace, 'compose.yaml'), source)
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )

    await initComposeRuntime({ path: workspace, project: 'poc75-example', service: ['web:3000'] }, command)

    expect(readFileSync(join(workspace, 'compose.yaml'), 'utf8')).toBe(source)
    expect(existsSync(join(workspace, '.portta'))).toBe(false)
    expect(existsSync(join(mocks.root, 'runtime', 'compose'))).toBe(true)
  })

  it('does not report Compose-generated volume and network names as shared', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      ...sourceModel,
      volumes: { data: { name: 'isolated_data' } },
      networks: { default: { name: 'isolated_default' } },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(model),
    )

    const plan = await prepareComposeRuntime({ path: workspace, project: 'isolated' }, command)

    expect(plan.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'shared_volume' }),
        expect.objectContaining({ code: 'shared_network' }),
      ]),
    )
  })

  it('reports explicitly fixed volume and network names', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mkdirSync(join(workspace, '.portta'))
    writeFileSync(
      join(workspace, '.portta', 'runtime.json'),
      JSON.stringify({ schemaVersion: 1, compose: { mode: 'manual' } }),
    )
    const model = {
      ...sourceModel,
      volumes: { data: { name: 'production-data' } },
      networks: { default: { name: 'production-network' } },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(model),
    )

    const plan = await prepareComposeRuntime({ path: workspace, project: 'isolated' }, command)

    expect(plan.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'shared_volume' }),
        expect.objectContaining({ code: 'shared_network' }),
      ]),
    )
  })

  it('refuses fixed networks and volumes in auto mode before writing an overlay', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      ...sourceModel,
      volumes: { data: { name: 'production-data' } },
      networks: { default: { name: 'production-network' } },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version') ? result('2.24.4') : args.includes('branch') ? result('') : result(model),
    )

    await expect(prepareComposeRuntime({ path: workspace, project: 'isolated' }, command)).rejects.toMatchObject({
      hint: expect.stringContaining('network default'),
    })
    expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
  })

  it('requires explicit intent for multi-port infrastructure images', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const model = {
      services: {
        web: { image: 'nginx', ports: [{ target: 3000, published: '3000' }] },
        mailpit: {
          image: 'axllent/mailpit',
          ports: [
            { target: 1025, published: '1025' },
            { target: 8025, published: '8025' },
          ],
        },
        rustfs: {
          image: 'rustfs/rustfs',
          ports: [
            { target: 9000, published: '9000' },
            { target: 9001, published: '9001' },
          ],
        },
      },
    }
    const final = { services: { web: {} } }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result(final)
            : result(model),
    )

    const plan = await prepareComposeRuntime({ path: workspace }, command)

    expect(plan.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web', route: 'http', containerPort: 3000 }),
        expect.objectContaining({ name: 'mailpit', route: 'none' }),
        expect.objectContaining({ name: 'rustfs', route: 'none' }),
      ]),
    )
  })

  it('uses !override only when a routed service has no network metadata to preserve', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    const simple = { services: { web: { image: 'nginx', ports: [{ target: 80 }], networks: { default: null } } } }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result({ services: { web: {} } })
            : result(simple),
    )

    const plan = await prepareComposeRuntime({ path: workspace }, command)
    expect(readFileSync(plan.compose.generatedOverlay, 'utf8')).toContain(
      'networks: !override\n      - default\n      - portta',
    )
  })

  it('refuses a fixed container name before it writes a runtime artifact', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : result({ services: { web: { image: 'nginx', container_name: 'fixed', ports: [{ target: 80 }] } } }),
    )

    await expect(prepareComposeRuntime({ path: workspace }, command)).rejects.toMatchObject({
      hint: expect.stringContaining('container_name'),
    })
    expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
  })

  it('previews a not-supported adoption without writing runtime state', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    const source = 'services:\n  web:\n    image: nginx\n    container_name: fixed\n'
    writeFileSync(join(workspace, 'compose.yaml'), source)
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : result({ services: { web: { image: 'nginx', container_name: 'fixed', ports: [{ target: 80 }] } } }),
    )

    const plan = await adoptComposeRuntime({ path: workspace, dryRun: true }, command)

    expect(plan.outcome).toBe('not_supported')
    expect(plan.pending).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'container_name', option: '--remove-container-name web' }),
      ]),
    )
    expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
    expect(readFileSync(join(workspace, 'compose.yaml'), 'utf8')).toBe(source)
  })

  it('removes a fixed container name only after an explicit adoption decision', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services:\n  web:\n    image: nginx\n    container_name: fixed\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { web: {} } })
            : result({ services: { web: { image: 'nginx', container_name: 'fixed', ports: [{ target: 80 }] } } }),
    )

    const plan = await adoptComposeRuntime({ path: workspace, removeContainerName: ['web'] }, command)

    expect(plan.outcome).toBe('isolated')
    expect(plan.compatibility.removeContainerNames).toEqual(['web'])
    expect(readFileSync(plan.compose.generatedOverlay, 'utf8')).toContain('container_name: !reset null')
    expect(readFileSync(join(mocks.root, 'runtime', 'compose', plan.id, 'runtime.json'), 'utf8')).toContain(
      'removeContainerNames',
    )
  })

  it('uses the persisted plan for down without rediscovering Compose inputs', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    // The plan id is derived by production code, so prepare once and then remove the source to prove down does not rediscover it.
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    const plan = await prepareComposeRuntime({ path: workspace }, command)
    rmSync(join(workspace, 'compose.yaml'))
    mocks.runProcess.mockClear()
    mocks.runProcess.mockResolvedValue(result(''))

    await runtimeAction('down', { path: workspace }, command)
    expect(mocks.runProcess).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-p', plan.compose.projectName, '-f', plan.compose.generatedOverlay, 'down']),
      expect.objectContaining({ cwd: workspace, stdio: 'stream' }),
    )
  })

  it.each(['up', 'restart'] as const)('regenerates a stale plan before %s', async (action) => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    const source = join(workspace, 'compose.yaml')
    writeFileSync(source, 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    await prepareComposeRuntime({ path: workspace }, command)
    writeFileSync(source, 'services:\n  changed: {}\n')
    mocks.runProcess.mockClear()

    await runtimeAction(action, { path: workspace }, command)
    expect(mocks.runProcess.mock.calls.filter(([, args]) => args.includes('config')).length).toBe(2)
    expect(mocks.runProcess.mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining(action === 'up' ? ['up', '-d'] : ['restart']),
    )
  })

  it('keeps an explicit Compose namespace when it regenerates a stale plan', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    const source = join(workspace, 'compose.yaml')
    writeFileSync(source, 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    await prepareComposeRuntime({ path: workspace, project: 'poc75-example' }, command)
    writeFileSync(source, 'services:\n  changed: {}\n')
    mocks.runProcess.mockClear()

    await runtimeAction('up', { path: workspace }, command)

    expect(mocks.runProcess.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['-p', 'poc75-example', 'up', '-d']))
  })

  it('rebuilds images only when up is asked to build', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    await prepareComposeRuntime({ path: workspace, project: 'poc75-example' }, command)
    const upCall = () => mocks.runProcess.mock.calls.map(([, args]) => args as string[]).find((a) => a.includes('up'))

    mocks.runProcess.mockClear()
    await runtimeAction('up', { path: workspace }, command)
    expect(upCall()).not.toContain('--build')

    mocks.runProcess.mockClear()
    await runtimeAction('up', { path: workspace, build: true }, command)
    expect(upCall()).toEqual(expect.arrayContaining(['up', '-d', '--build']))
  })

  it('preserves the recorded namespace on re-adoption and refreshes hosts after a domain change', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('feature/renamed')
          : args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    await prepareComposeRuntime({ path: workspace, project: 'existing-data' }, command)
    const adopted = await adoptComposeRuntime({ path: workspace }, command)
    expect(adopted.compose.projectName).toBe('existing-data')
    const beforeRename = readFileSync(join(mocks.root, 'runtime/compose', adopted.id, 'plan.json'), 'utf8')
    await expect(prepareComposeRuntime({ path: workspace, project: 'different-data' }, command)).rejects.toThrow(
      'recorded Compose namespace cannot be changed',
    )
    expect(readFileSync(join(mocks.root, 'runtime/compose', adopted.id, 'plan.json'), 'utf8')).toBe(beforeRename)
    mocks.domain = 'new.example.test'
    await runtimeAction('up', { path: workspace }, command)
    const saved = JSON.parse(readFileSync(join(mocks.root, 'runtime/compose', adopted.id, 'plan.json'), 'utf8'))
    expect(saved.compose.projectName).toBe('existing-data')
    expect(saved.services[0].host).toBe('existing-data--web.new.example.test')
  })

  it('refuses normalized service hostname collisions before persisting adoption intent', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : result({
              services: {
                'web-api': { expose: [3000] },
                web_api: { expose: [3001] },
              },
            }),
    )
    await expect(adoptComposeRuntime({ path: workspace }, command)).rejects.toThrow(/multiple services derive/)
    expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
  })

  it.each(['prepare', 'up'] as const)('refuses a stopped foreign namespace before %s', async (operation) => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    if (operation === 'up') await prepareComposeRuntime({ path: workspace, project: 'shop' }, command)
    mocks.runProcess.mockClear()
    mocks.containers = [
      {
        id: 'foreign',
        name: 'shop-web-1',
        image: 'nginx',
        state: 'exited',
        ports: [],
        networks: [],
        labels: {
          'com.docker.compose.project': 'shop',
          'com.docker.compose.service': 'web',
          'com.docker.compose.project.working_dir': '/another/worktree',
        },
      },
    ]
    const action =
      operation === 'up'
        ? runtimeAction('up', { path: workspace }, command)
        : prepareComposeRuntime({ path: workspace, project: 'shop' }, command)
    await expect(action).rejects.toThrow(/another or unidentified workspace/)
    expect(mocks.runProcess.mock.calls.some(([, args]) => args.includes('up'))).toBe(false)
    if (operation === 'prepare') expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
  })

  it('refuses orphaned volumes and colliding internal Traefik service names before adoption', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : result({ services: { web: { expose: [3000] } } }),
    )
    mocks.volumes = ['shop_database']
    await expect(prepareComposeRuntime({ path: workspace, project: 'shop' }, command)).rejects.toThrow(
      /volumes without a proven/,
    )
    mocks.volumes = []
    mocks.containers = [
      {
        id: 'other',
        name: 'other-app-1',
        image: 'nginx',
        state: 'running',
        ports: [],
        networks: [],
        labels: {
          'com.docker.compose.project': 'other',
          'com.docker.compose.service': 'app',
          'traefik.enable': 'true',
          'traefik.http.services.shop-web.loadbalancer.server.port': '3000',
        },
      },
    ]
    await expect(prepareComposeRuntime({ path: workspace, project: 'shop' }, command)).rejects.toThrow(
      /Traefik identifier shop-web/,
    )
    expect(existsSync(join(mocks.root, 'runtime'))).toBe(false)
  })

  it('preserves an explicitly exported Compose namespace', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    vi.stubEnv('COMPOSE_PROJECT_NAME', 'existing-export')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version') ? result('2.24.4') : args.includes('branch') ? result('') : result({ services: {} }),
    )
    expect((await prepareComposeRuntime({ path: workspace }, command)).compose.projectName).toBe('existing-export')
  })

  it('regenerates a plan when runtime intent changes', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    await prepareComposeRuntime({ path: workspace }, command)
    mkdirSync(join(workspace, '.portta'))
    writeFileSync(
      join(workspace, '.portta', 'runtime.json'),
      JSON.stringify({ schemaVersion: 1, services: { web: { http: { port: 8080 } } } }),
    )
    mocks.runProcess.mockClear()

    await runtimeAction('up', { path: workspace }, command)

    expect(mocks.runProcess.mock.calls.filter(([, args]) => args.includes('config')).length).toBe(2)
    expect(mocks.runProcess.mock.calls.at(-1)?.[1]).toEqual(expect.arrayContaining(['up', '-d']))
  })

  it('rebuilds an older plan that has no manifest fingerprint', async () => {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg) => arg.endsWith('.tmp'))
            ? result(finalModel)
            : result(sourceModel),
    )
    const plan = await prepareComposeRuntime({ path: workspace }, command)
    const saved = JSON.parse(
      readFileSync(join(mocks.root, 'runtime', 'compose', plan.id, 'plan.json'), 'utf8'),
    ) as Record<string, unknown>
    delete saved.manifest
    writeFileSync(join(mocks.root, 'runtime', 'compose', plan.id, 'plan.json'), JSON.stringify(saved))
    mocks.runProcess.mockClear()

    await runtimeAction('up', { path: workspace }, command)

    expect(mocks.runProcess.mock.calls.filter(([, args]) => args.includes('config')).length).toBe(2)
  })
})

describe('who may open a routed hostname on a public host', () => {
  const model = {
    services: {
      web: { ports: [{ target: 3000, published: '80' }] },
      api: { ports: [{ target: 4000, published: '81' }] },
    },
  }

  function arrange() {
    const workspace = temp()
    mocks.root = join(temp(), 'gateway')
    mocks.profile = 'remote-public'
    writeFileSync(join(workspace, 'compose.yaml'), 'services: {}\n')
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version')
        ? result('2.24.4')
        : args.includes('branch')
          ? result('')
          : args.includes('config') && args.some((arg: string) => arg.endsWith('.tmp'))
            ? result({ services: { web: {}, api: {} } })
            : result(model),
    )
    return workspace
  }
  const registry = () => readProtectionStore(join(mocks.root, 'state/auth/protections.json'))
  const overlayOf = (plan: { compose: { generatedOverlay: string } }) =>
    readFileSync(plan.compose.generatedOverlay, 'utf8')

  it('asks for a decision per routed service, and writes nothing while it is missing', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, dryRun: true }, command)
    expect(plan.outcome).toBe('not_supported')
    expect(plan.pending.filter((entry) => entry.code === 'public_exposure').map((entry) => entry.service)).toEqual([
      'web',
      'api',
    ])
    await expect(prepareComposeRuntime({ path: workspace }, command)).rejects.toThrow(/not ready/)
    expect(existsSync(join(mocks.root, 'state/auth/protections.json'))).toBe(false)
  })

  it('puts every routed service behind ForwardAuth without naming a second router', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
    const overlay = overlayOf(plan)
    for (const service of ['web', 'api']) {
      const router = `${plan.compose.projectName}-${service}`
      expect(overlay).toContain(`traefik.http.routers.${router}.middlewares=portta-forward-auth@file`)
      expect(overlay).toContain(`traefik.http.routers.${router}.service=${router}`)
      expect(overlay).not.toContain(`traefik.http.routers.${router}.rule`)
    }
  })

  it('records the decision by hostname, keeps only a hash, and never writes the password to the plan', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
    const [first, second] = plan.services
    const records = registry().protections
    const web = records.find((record) => record.host === first?.host)
    const api = records.find((record) => record.host === second?.host)
    expect(web).toMatchObject({ mode: 'protected', user: 'reviewer' })
    expect(web?.hash).toMatch(/^\$portta\$scrypt/)
    expect(api).toMatchObject({ mode: 'public' })
    expect(api).not.toHaveProperty('hash')
    const stored = readFileSync(join(mocks.root, 'runtime/compose', plan.id, 'plan.json'), 'utf8')
    expect(stored).not.toMatch(/password/i)
  })

  it('does not ask again once the registry holds a decision', async () => {
    const workspace = arrange()
    await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
    const again = await prepareComposeRuntime({ path: workspace }, command)
    expect(again.outcome).toBe('isolated')
    expect(again.pending).toEqual([])
  })

  it('refuses a service that is not routed, and both flags on one service', async () => {
    const workspace = arrange()
    await expect(prepareComposeRuntime({ path: workspace, protect: ['nope'] }, command)).rejects.toThrow(
      /no routed service/,
    )
    await expect(
      prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['web'] }, command),
    ).rejects.toThrow(/both/)
  })

  it('leaves the overlay and the question alone outside a public host', async () => {
    const workspace = arrange()
    mocks.profile = 'local'
    const plan = await prepareComposeRuntime({ path: workspace }, command)
    expect(plan.outcome).toBe('isolated')
    expect(plan.pending.some((entry) => entry.code === 'public_exposure')).toBe(false)
    expect(overlayOf(plan)).not.toContain('portta-forward-auth')
    await expect(prepareComposeRuntime({ path: workspace, protect: ['web'] }, command)).rejects.toThrow(/public host/)
  })

  it.each(['up', 'restart'] as const)(
    'regenerates a plan made for another profile before %s, so missing decisions stop it',
    async (action) => {
      const workspace = arrange()
      mocks.profile = 'local'
      await prepareComposeRuntime({ path: workspace }, command)
      mocks.profile = 'remote-public'
      mocks.runProcess.mockClear()
      await expect(runtimeAction(action, { path: workspace }, command)).rejects.toThrow(/not ready/)
      expect(mocks.runProcess.mock.calls.some(([, args]) => args.includes('up') || args.includes('restart'))).toBe(
        false,
      )
    },
  )

  it.each([
    { 'traefik.http.routers.mine.rule': 'Host(`x`)' },
    { 'Traefik.HTTP.Routers.bypass.Rule': 'Host(`x`)' },
    ['Traefik.HTTP.Routers.bypass.Rule=Host(`x`)'],
    { 'portta.hostname': 'a-different--service' },
  ])('refuses a project that brings its own Traefik router: %j', async (labels) => {
    const workspace = arrange()
    const labelled = {
      services: {
        web: { ports: [{ target: 3000, published: '80' }], labels },
        api: { ports: [{ target: 4000, published: '81' }] },
      },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version') ? result('2.24.4') : args.includes('branch') ? result('') : result(labelled),
    )
    await expect(
      prepareComposeRuntime({ path: workspace, public: ['web', 'api'], dryRun: true }, command),
    ).rejects.toThrow(/Traefik routing of its own/)
  })

  it('does not inherit a decision that belongs to another service', async () => {
    const workspace = arrange()
    const first = await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
    const records = registry()
    const stolen = records.protections.find((record) => record.service === 'web')!
    const { writeProtectionStore } = await import('portta-core')
    writeProtectionStore(join(mocks.root, 'state/auth/protections.json'), {
      ...records,
      protections: records.protections.map((record) => (record === stolen ? { ...record, service: 'other' } : record)),
    })
    const again = await prepareComposeRuntime({ path: workspace, dryRun: true }, command)
    expect(again.pending.map((entry) => entry.service)).toEqual([first.services[0]?.name])
  })

  it('refuses ambiguous routing labels whose keys differ only by case', async () => {
    const workspace = arrange()
    const labelled = {
      services: {
        web: {
          ...model.services.web,
          labels: {
            'traefik.http.routers.shop-web.middlewares': 'portta-forward-auth@file',
            'Traefik.HTTP.Routers.shop-web.Middlewares': 'strip@docker',
          },
        },
        api: model.services.api,
      },
    }
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) =>
      args.includes('version') ? result('2.24.4') : args.includes('branch') ? result('') : result(labelled),
    )
    await expect(
      prepareComposeRuntime({ path: workspace, project: 'shop', public: ['web', 'api'] }, command),
    ).rejects.toMatchObject({ hint: expect.stringContaining('conflicting') })
  })

  it.each(['up', 'restart'] as const)(
    'takes a project down during %s when image labels add a mixed-case router',
    async (action) => {
      const workspace = arrange()
      await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
      const calls: string[][] = []
      mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
        calls.push(args)
        if (args.includes('version')) return result('2.24.4')
        if (args.includes('ps')) return result('c1\n')
        if (args[0] === 'inspect')
          return result(
            JSON.stringify({ 'com.docker.compose.service': 'api', 'Traefik.HTTP.Routers.baked.Rule': 'Host(`x`)' }),
          )
        return result('')
      })
      await expect(runtimeAction(action, { path: workspace }, command)).rejects.toThrow(/taken down/)
      expect(calls.some((args) => args.includes('down'))).toBe(true)
      expect(calls.some((args) => args.includes('up') && !args.includes('--no-start'))).toBe(false)
    },
  )

  it('recreates and inspects public containers before restarting even when an optional service has no container', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, protect: ['web'], public: ['api'] }, command)
    const calls: string[][] = []
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      calls.push(args)
      if (args.includes('version')) return result('2.24.4')
      if (args.includes('ps')) return result('c1\n')
      if (args[0] === 'inspect')
        return result(
          JSON.stringify({
            'com.docker.compose.service': 'web',
            'traefik.enable': 'true',
            'portta.hostname': hostLabel({ project: plan.compose.projectName, service: 'web' }),
            [`traefik.http.routers.${plan.compose.projectName}-web.middlewares`]: 'portta-forward-auth@file',
          }),
        )
      return result('')
    })

    await runtimeAction('restart', { path: workspace }, command)

    const create = calls.findIndex((args) => args.includes('--force-recreate'))
    const inspect = calls.findIndex((args) => args[0] === 'inspect')
    const start = calls.findIndex((args) => args.includes('up') && !args.includes('--no-start'))
    expect(create).toBeGreaterThanOrEqual(0)
    expect(calls[create]).toContain('--no-start')
    expect(inspect).toBeGreaterThan(create)
    expect(start).toBeGreaterThan(inspect)
    expect(calls.some((args) => args.includes('restart'))).toBe(false)
  })

  it('does not start a routed container whose inspected labels omit the gate', async () => {
    const workspace = arrange()
    await prepareComposeRuntime({ path: workspace, public: ['web', 'api'] }, command)
    mocks.runProcess.mockClear()
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('version')) return result('2.24.4')
      if (args.includes('ps')) return result('c1\n')
      if (args[0] === 'inspect')
        return result(JSON.stringify({ 'com.docker.compose.service': 'web', 'traefik.enable': 'true' }))
      return result('')
    })
    await expect(runtimeAction('up', { path: workspace }, command)).rejects.toMatchObject({
      hint: expect.stringContaining('ForwardAuth is not enforced'),
    })
    expect(mocks.runProcess.mock.calls.some(([, args]) => args.includes('up') && !args.includes('--no-start'))).toBe(
      false,
    )
  })

  it('refuses a created container whose canonical hostname label differs from the protected plan', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, public: ['web', 'api'] }, command)
    mocks.runProcess.mockClear()
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('version')) return result('2.24.4')
      if (args.includes('ps')) return result('c1\n')
      if (args[0] === 'inspect')
        return result(
          JSON.stringify({
            'com.docker.compose.service': 'web',
            'traefik.enable': 'true',
            'portta.hostname': 'other--web',
            [`traefik.http.routers.${plan.compose.projectName}-web.middlewares`]: 'portta-forward-auth@file',
          }),
        )
      return result('')
    })
    await expect(runtimeAction('up', { path: workspace }, command)).rejects.toMatchObject({
      hint: expect.stringContaining('canonical hostname'),
    })
    expect(mocks.runProcess.mock.calls.some(([, args]) => args.includes('up') && !args.includes('--no-start'))).toBe(
      false,
    )
  })

  it('refuses an ungated replica even when a later replica of the same service carries the gate', async () => {
    const workspace = arrange()
    const plan = await prepareComposeRuntime({ path: workspace, public: ['web', 'api'] }, command)
    mocks.runProcess.mockClear()
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('version')) return result('2.24.4')
      if (args.includes('ps')) return result('c1\nc2\n')
      if (args[0] === 'inspect')
        return result(
          [
            { 'com.docker.compose.service': 'web', 'traefik.enable': 'true' },
            {
              'com.docker.compose.service': 'web',
              'traefik.enable': 'true',
              [`traefik.http.routers.${plan.compose.projectName}-web.middlewares`]: 'portta-forward-auth@file',
            },
          ]
            .map((labels) => JSON.stringify(labels))
            .join('\n'),
        )
      return result('')
    })

    await expect(runtimeAction('up', { path: workspace }, command)).rejects.toMatchObject({
      hint: expect.stringContaining('ForwardAuth is not enforced'),
    })
    expect(mocks.runProcess.mock.calls.some(([, args]) => args.includes('up') && !args.includes('--no-start'))).toBe(
      false,
    )
  })
})
