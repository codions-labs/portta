import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ContainerRecord,
  readProtectionStore,
  renderAliases,
  renderShares,
  writeProtectionStore,
} from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimePlan } from './compose-runtime.js'

const mocks = vi.hoisted(() => ({ root: '', containers: [] as unknown[] }))
vi.mock('../context.js', () => ({
  gatewayContext: () => ({ root: mocks.root, config: { ...config, projectName: 'portta' } }),
}))
vi.mock('../docker.js', () => ({ inspectContainers: vi.fn(async () => mocks.containers) }))

import { applyHostnameMigration, migrateHostnames, planHostnameMigration } from './migrate-hostnames.js'

const config = { domain: 'example.test', network: 'portta', profile: 'remote-public' as const, publicDomain: null }
const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  mocks.containers = []
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'portta-hostname-migration-'))
  roots.push(root)
  const workspace = join(root, 'project')
  const directory = join(root, 'runtime/compose/id')
  const dynamic = join(root, 'config/traefik/dynamic')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(directory, { recursive: true })
  mkdirSync(dynamic, { recursive: true })
  const source = join(workspace, 'compose.yaml')
  writeFileSync(source, 'services:\n  web: { image: nginx }\n')
  const plan: RuntimePlan = {
    version: 1,
    driver: 'compose',
    id: 'id',
    workspace,
    createdAt: '2026-01-01T00:00:00Z',
    inputs: [],
    capabilities: { composeVersion: '2.24.4' },
    manifest: {
      local: { path: join(workspace, '.portta/runtime.json'), digest: null },
      stored: { path: join(directory, 'runtime.json'), digest: null },
    },
    compose: {
      projectName: 'shop',
      projectDirectory: workspace,
      files: [source],
      profiles: [],
      mode: 'auto',
      generatedOverlay: join(directory, 'compose.portta.yaml'),
    },
    profile: 'remote-public',
    outcome: 'isolated',
    compatibility: { removeContainerNames: [], allowSharedNetworks: false, allowSharedVolumes: false },
    pending: [],
    findings: [],
    services: [
      {
        name: 'web',
        route: 'http',
        host: 'shop-web.example.test',
        containerPort: 3000,
        networks: ['default'],
        networkMerge: 'replace',
        removeContainerName: false,
      },
      {
        name: 'postgres',
        route: 'none',
        host: null,
        containerPort: null,
        networks: ['default'],
        networkMerge: 'replace',
        removeContainerName: false,
      },
    ],
  }
  const planFile = join(directory, 'plan.json')
  writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`)
  writeFileSync(plan.compose.generatedOverlay, '# old generated overlay\n')
  const storeFile = join(root, 'state/auth/protections.json')
  writeProtectionStore(storeFile, {
    version: 1,
    protections: [
      {
        scope: 'host:shop-web.example.test',
        host: 'shop-web.example.test',
        entryPoints: ['websecure'],
        mode: 'protected',
        user: 'reviewer',
        hash: '$portta$scrypt$existing-credential',
        epoch: 7,
        label: 'Shop',
        project: 'shop',
        service: 'web',
        tech: { id: 'node', label: 'Node' },
      },
    ],
  })
  return { root, workspace, plan, planFile, storeFile, dynamic, source }
}

describe('hostname migration', () => {
  it('previews without writing state and applies without changing namespace, exposure or source Compose', () => {
    const f = fixture()
    const source = readFileSync(f.source, 'utf8')
    const before = readFileSync(f.planFile, 'utf8')
    const preview = planHostnameMigration(f.root, config)
    expect(preview.moves).toEqual([
      {
        project: 'shop',
        service: 'web',
        oldHost: 'shop-web.example.test',
        newHost: 'shop--web.example.test',
        kind: 'service',
      },
    ])
    expect(readFileSync(f.planFile, 'utf8')).toBe(before)
    expect(existsSync(join(f.root, 'state/migrations'))).toBe(false)

    const backup = applyHostnameMigration(preview)!
    const saved = JSON.parse(readFileSync(f.planFile, 'utf8')) as RuntimePlan
    expect(saved.compose.projectName).toBe('shop')
    expect(saved.services[0]?.host).toBe('shop--web.example.test')
    expect(saved.services[1]).toEqual(f.plan.services[1])
    expect(readFileSync(f.source, 'utf8')).toBe(source)
    expect(readFileSync(saved.compose.generatedOverlay, 'utf8')).toContain('portta.hostname=shop--web')
    expect(readFileSync(saved.compose.generatedOverlay, 'utf8')).toContain('portta-forward-auth@file')
    expect(statSync(backup).mode & 0o777).toBe(0o700)
    expect(statSync(join(backup, 'migration.json')).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(join(backup, 'migration.json'), 'utf8')).status).toBe('complete')
  })

  it('preserves credentials and policy, invalidates the old session once, and is idempotent', () => {
    const f = fixture()
    const original = readProtectionStore(f.storeFile).protections[0]!
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readProtectionStore(f.storeFile).protections[0]).toEqual({
      ...original,
      host: 'shop--web.example.test',
      epoch: 8,
    })
    const again = planHostnameMigration(f.root, config)
    expect(again.files).toEqual([])
    expect(again.moves).toEqual([])
    expect(applyHostnameMigration(again)).toBeNull()
    expect(readProtectionStore(f.storeFile).protections[0]?.epoch).toBe(8)
  })

  it('resumes after credentials moved without rotating them again', () => {
    const f = fixture()
    const prepared = planHostnameMigration(f.root, config)
    writeProtectionStore(f.storeFile, prepared.store)
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readProtectionStore(f.storeFile).protections[0]?.epoch).toBe(8)
    expect(JSON.parse(readFileSync(f.planFile, 'utf8')).services[0].host).toBe('shop--web.example.test')
  })

  it('migrates decisions for stopped environments that have no Runtime Plan', () => {
    const f = fixture()
    const store = readProtectionStore(f.storeFile)
    writeProtectionStore(f.storeFile, {
      ...store,
      protections: [
        ...store.protections,
        {
          scope: 'detached',
          host: 'stopped-api.example.test',
          entryPoints: ['websecure'],
          mode: 'public',
          epoch: 2,
          label: 'Stopped',
          project: 'stopped',
          service: 'api',
        },
      ],
    })
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readProtectionStore(f.storeFile).protections.find((record) => record.scope === 'detached')).toMatchObject({
      host: 'stopped--api.example.test',
      mode: 'public',
      epoch: 3,
    })
  })

  it('migrates public shares and removes an alias retaining the retired generated URL', () => {
    const f = fixture()
    const shareFile = join(f.dynamic, 'portta-shares.yaml')
    writeFileSync(
      shareFile,
      renderShares([
        {
          id: 'abc123',
          project: 'shop',
          service: 'web',
          host: 'shop-web-abc123-share.example.test',
          entryPoint: 'websecure',
          container: 'shop-web-1',
          port: 3000,
          mode: 'public' as const,
          expiresAt: 9999999999,
        },
      ]),
    )
    const aliasFile = join(f.dynamic, 'portta-aliases.yaml')
    writeFileSync(
      aliasFile,
      renderAliases(
        [
          {
            project: 'shop',
            service: 'web',
            container: 'shop-web-1',
            host: 'shop-web.example.test',
            port: 3000,
            entryPoint: 'websecure',
          },
        ],
        true,
      ),
    )
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readFileSync(shareFile, 'utf8')).toContain('shop--web--share-abc123.example.test')
    expect(readFileSync(shareFile, 'utf8')).not.toContain('shop-web-abc123-share.example.test')
    expect(readFileSync(aliasFile, 'utf8')).not.toContain('shop-web.example.test')
  })

  it('refuses collisions before any write and preserves a custom host', () => {
    const f = fixture()
    const store = readProtectionStore(f.storeFile)
    writeProtectionStore(f.storeFile, {
      ...store,
      protections: [
        ...store.protections,
        {
          scope: 'another',
          host: 'shop--web.example.test',
          entryPoints: ['websecure'],
          mode: 'public',
          epoch: 1,
          label: 'Other',
          project: 'other',
          service: 'web',
        },
      ],
    })
    const before = readFileSync(f.storeFile, 'utf8')
    expect(() => planHostnameMigration(f.root, config)).toThrow(/collision|multiple protection/)
    expect(readFileSync(f.storeFile, 'utf8')).toBe(before)
    expect(existsSync(join(f.root, 'state/migrations'))).toBe(false)
  })

  it('keeps a custom hostname in a manual integration and refuses an unproven automatic origin', () => {
    const f = fixture()
    f.plan.compose.mode = 'manual'
    f.plan.services[0]!.host = 'custom.customer.test'
    writeFileSync(f.planFile, `${JSON.stringify(f.plan, null, 2)}\n`)
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(JSON.parse(readFileSync(f.planFile, 'utf8')).services[0].host).toBe('custom.customer.test')
    f.plan.compose.mode = 'auto'
    writeFileSync(f.planFile, `${JSON.stringify(f.plan, null, 2)}\n`)
    expect(() => planHostnameMigration(f.root, config)).toThrow(/origin.*not established/)
  })

  it('migrates the exact TCP template with canonical overrides, retaining secrets and service selection', () => {
    const f = fixture()
    const tcp = join(f.workspace, 'compose.portta-tcp.yaml')
    writeFileSync(
      tcp,
      [
        '# keep this integration comment',
        'services:',
        '  postgres:',
        '    labels:',
        "      - 'traefik.tcp.routers.${COMPOSE_PROJECT_NAME}-postgres.rule=HostSNIRegexp(`^${COMPOSE_PROJECT_NAME}-postgres\\..+$`)'",
        '      - traefik.enable=true',
        '',
      ].join('\n'),
    )
    const envFile = join(f.workspace, '.env')
    writeFileSync(envFile, 'DB_PASSWORD=private-value\n')
    f.plan.compose.mode = 'manual'
    f.plan.compose.files.push(tcp)
    f.plan.inputs.push({ path: tcp, digest: 'old' })
    writeFileSync(f.planFile, `${JSON.stringify(f.plan, null, 2)}\n`)

    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readFileSync(tcp, 'utf8')).toContain('# keep this integration comment')
    expect(readFileSync(tcp, 'utf8')).toContain('portta.hostname=${PORTTA_POSTGRES_HOST_LABEL}')
    expect(readFileSync(tcp, 'utf8')).not.toContain('COMPOSE_PROJECT_NAME}-postgres\\..')
    expect(readFileSync(envFile, 'utf8')).toBe('DB_PASSWORD=private-value\nPORTTA_POSTGRES_HOST_LABEL=shop--postgres\n')
    const saved = JSON.parse(readFileSync(f.planFile, 'utf8')) as RuntimePlan
    expect(saved.services[1]).toEqual(f.plan.services[1])
    expect(saved.inputs.find((input) => input.path === tcp)?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(planHostnameMigration(f.root, config).files).toEqual([])
  })

  it('rewrites an exact recorded HTTP rule and refuses a composite rule before changing state', () => {
    const f = fixture()
    f.plan.compose.mode = 'manual'
    writeFileSync(f.planFile, `${JSON.stringify(f.plan, null, 2)}\n`)
    const source = (rule: string) =>
      ['services:', '  web:', '    labels:', `      - 'traefik.http.routers.shop-web.rule=${rule}'`, ''].join('\n')
    writeFileSync(f.source, source('Host(`shop-web.example.test`) || Host(`another.example.test`)'))
    expect(() => planHostnameMigration(f.root, config)).toThrow(/explicit migration/)
    expect(readProtectionStore(f.storeFile).protections[0]?.epoch).toBe(7)
    writeFileSync(f.source, source('Host(`shop-web.example.test`)'))
    applyHostnameMigration(planHostnameMigration(f.root, config))
    expect(readFileSync(f.source, 'utf8')).toContain('Host(`shop--web.example.test`)')
    expect(readFileSync(f.source, 'utf8')).not.toContain('shop-web.example.test')
  })

  it('refuses a namespace whose containers belong to a different workspace', () => {
    const f = fixture()
    const containers: ContainerRecord[] = [
      {
        id: 'other',
        name: 'shop-web-1',
        image: 'nginx',
        state: 'running',
        ports: [],
        networks: [],
        labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.project.working_dir': '/someone-else' },
      },
    ]
    expect(() => planHostnameMigration(f.root, config, containers)).toThrow(/another or unidentified workspace/)
  })

  it('refuses a changed file between preview and apply', () => {
    const f = fixture()
    const plan = planHostnameMigration(f.root, config)
    writeFileSync(f.planFile, '{}\n')
    expect(() => applyHostnameMigration(plan)).toThrow(/changed after migration preview/)
    expect(existsSync(join(f.root, 'state/migrations'))).toBe(false)
  })

  it('requires the panel to be stopped before apply and never starts applications', async () => {
    const f = fixture()
    mocks.root = f.root
    mocks.containers = [
      {
        name: 'portta-web-1',
        state: 'running',
        labels: { 'com.docker.compose.project': 'portta', 'com.docker.compose.service': 'web' },
      },
    ]
    const command = { optsWithGlobals: () => ({ quiet: true }) } as never
    await expect(migrateHostnames({ apply: true }, command)).rejects.toThrow(/stop the panel/)
    expect(existsSync(join(f.root, 'state/migrations'))).toBe(false)
  })
})
