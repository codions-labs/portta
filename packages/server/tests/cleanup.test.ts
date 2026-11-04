// Cleaning the Docker host is the one place the panel deletes data that is not
// its own. What these tests hold on to is who may be touched: Portta's
// networks, images and volumes, Docker's default networks and anything a
// container — running or not — still references must survive every request,
// whatever the request says.

import type {
  DockerDiskUsage as DiskUsageSummary,
  DockerImageList,
  DockerNetworkList,
  DockerPruneResult,
  DockerResourceRemoveResult,
  DockerVolumeList,
} from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import type { DockerDiskUsage, DockerNetwork } from '../src/services/docker/types.ts'
import { makeApp, post } from './helpers.ts'

const MB = 1024 * 1024
const ANON = 'a'.repeat(64)

// A host with a stack of Portta's, one project that is running, one that left
// a stopped container behind, and the leftovers of a project that is gone.
const disk: DockerDiskUsage = {
  LayersSize: 900 * MB,
  Images: [
    { Id: 'sha256:traefik', RepoTags: ['traefik:v3.7.12'], Created: 1, Size: 200 * MB, SharedSize: 0, Containers: 0 },
    {
      Id: 'sha256:web',
      RepoTags: ['ghcr.io/codions-labs/portta:1.0'],
      Created: 1,
      Size: 300 * MB,
      SharedSize: 0,
      Containers: 1,
    },
    {
      Id: 'sha256:shop',
      RepoTags: ['shop:latest', 'shop:v2'],
      Created: 1,
      Size: 150 * MB,
      SharedSize: 50 * MB,
      Containers: 1,
    },
    { Id: 'sha256:old', RepoTags: ['old-app:1'], Created: 1, Size: 120 * MB, SharedSize: 20 * MB, Containers: 0 },
    { Id: 'sha256:stopped', RepoTags: ['batch:1'], Created: 1, Size: 80 * MB, SharedSize: 0, Containers: 1 },
    {
      Id: 'sha256:dangling',
      RepoTags: ['<none>:<none>'],
      Created: 1,
      Size: 60 * MB,
      SharedSize: 10 * MB,
      Containers: 0,
    },
  ],
  Containers: [
    {
      Id: 'c-web',
      Names: ['/portta-web-1'],
      ImageID: 'sha256:web',
      State: 'running',
      Labels: { 'portta.managed': 'true' },
      Mounts: [{ Type: 'volume', Name: 'portta_acme', Source: '', Destination: '/acme', RW: true }],
      NetworkSettings: { Networks: { portta: {}, 'portta-web': {} } },
    },
    {
      Id: 'c-shop',
      Names: ['/shop-web-1'],
      ImageID: 'sha256:shop',
      State: 'running',
      Labels: { 'com.docker.compose.project': 'shop' },
      Mounts: [{ Type: 'volume', Name: 'shop_data', Source: '', Destination: '/data', RW: true }],
      NetworkSettings: { Networks: { shop_default: {} } },
    },
    {
      Id: 'c-batch',
      Names: ['/batch-1'],
      ImageID: 'sha256:stopped',
      State: 'exited',
      Labels: { 'com.docker.compose.project': 'batch' },
      Mounts: [{ Type: 'volume', Name: ANON, Source: '', Destination: '/tmp', RW: true }],
      NetworkSettings: { Networks: { batch_default: {} } },
    },
  ],
  Volumes: [
    {
      Name: 'portta_acme',
      Driver: 'local',
      Labels: { 'com.docker.compose.project': 'portta' },
      UsageData: { Size: 5 * MB, RefCount: 1 },
    },
    {
      Name: 'portta_orphan',
      Driver: 'local',
      Labels: { 'com.docker.compose.project': 'portta' },
      UsageData: { Size: 1 * MB, RefCount: 0 },
    },
    {
      Name: 'shop_data',
      Driver: 'local',
      Labels: { 'com.docker.compose.project': 'shop' },
      UsageData: { Size: 400 * MB, RefCount: 1 },
    },
    {
      Name: 'old_db',
      Driver: 'local',
      Labels: { 'com.docker.compose.project': 'old' },
      UsageData: { Size: 700 * MB, RefCount: 0 },
    },
    { Name: ANON, Driver: 'local', UsageData: { Size: 3 * MB, RefCount: 1 } },
    { Name: 'b'.repeat(64), Driver: 'local', UsageData: { Size: 2 * MB, RefCount: 0 } },
    { Name: 'remote_vol', Driver: 'nfs', UsageData: { Size: -1, RefCount: 0 } },
  ],
  BuildCache: [{ Size: 40 * MB }, { Size: 10 * MB }],
}

const networks: Partial<DockerNetwork>[] = [
  { Id: 'n-bridge', Name: 'bridge' },
  { Id: 'n-host', Name: 'host', Driver: 'host' },
  { Id: 'n-none', Name: 'none', Driver: 'null' },
  { Id: 'n-portta', Name: 'portta', Labels: { 'portta.managed': 'true' } },
  { Id: 'n-control', Name: 'portta-control', Internal: true },
  { Id: 'n-web', Name: 'portta-web', Internal: true },
  { Id: 'n-shop', Name: 'shop_default', Labels: { 'com.docker.compose.project': 'shop' } },
  { Id: 'n-batch', Name: 'batch_default', Labels: { 'com.docker.compose.project': 'batch' } },
  { Id: 'n-old', Name: 'old_default', Labels: { 'com.docker.compose.project': 'old' } },
]

const host = (failRemove: string[] = []) => makeApp({ networks, disk, failRemove })
const get = (app: ReturnType<typeof makeApp>['app'], path: string) => app.request(path)

describe('the networks', () => {
  it('say why a network cannot go, and let only the unreferenced ones through', async () => {
    const { app } = host()
    const body = (await (await get(app, '/api/docker/networks')).json()) as DockerNetworkList
    const by = Object.fromEntries(body.networks.map((network) => [network.name, network.protection]))
    expect(by).toEqual({
      bridge: 'docker',
      host: 'docker',
      none: 'docker',
      portta: 'portta',
      'portta-control': 'portta',
      'portta-web': 'portta',
      shop_default: 'in-use',
      // A stopped container still points at it: removing the network would
      // break the container the next time somebody starts it.
      batch_default: 'in-use',
      old_default: null,
    })
  })

  it('refuses Portta, Docker and in-use networks even when the request asks for them', async () => {
    const { app, docker } = host()
    const ids = networks.map((network) => network.Id)
    const response = await post(app, '/api/docker/networks/remove', { confirm: true, ids })
    const body = (await response.json()) as DockerResourceRemoveResult
    expect(response.status).toBe(200)
    expect(docker.calls.filter((call) => call.method === 'removeNetwork').map((call) => call.args[0])).toEqual([
      'n-old',
    ])
    expect(body).toMatchObject({ removed: 1, skipped: 8, failed: 0 })
    expect(body.results.find((entry) => entry.id === 'n-portta')?.reason).toMatch(/belongs to Portta/)
  })

  it('reports a network that vanished instead of failing the batch', async () => {
    const { app } = host()
    const response = await post(app, '/api/docker/networks/remove', { confirm: true, ids: ['n-old', 'n-ghost'] })
    const body = (await response.json()) as DockerResourceRemoveResult
    expect(body).toMatchObject({ removed: 1, skipped: 1 })
  })

  it('keeps going when Docker refuses one', async () => {
    const { app } = makeApp({
      networks: [
        { Id: 'n-a', Name: 'a_default' },
        { Id: 'n-b', Name: 'b_default' },
      ],
      disk,
      failRemove: ['n-a'],
    })
    const body = (await (
      await post(app, '/api/docker/networks/remove', { confirm: true, ids: ['n-a', 'n-b'] })
    ).json()) as DockerResourceRemoveResult
    expect(body).toMatchObject({ removed: 1, failed: 1, skipped: 0 })
    expect(body.results[0]?.reason).toMatch(/active endpoints/)
  })

  it('needs the confirmation and a list of ids', async () => {
    const { app, docker } = host()
    expect((await post(app, '/api/docker/networks/remove', { ids: ['n-old'] })).status).toBe(400)
    expect((await post(app, '/api/docker/networks/remove', { confirm: true, ids: [] })).status).toBe(400)
    expect(docker.calls.some((call) => call.method === 'removeNetwork')).toBe(false)
  })
})

describe('the images', () => {
  it('shows sizes, and what removing each would free', async () => {
    const { app } = host()
    const body = (await (await get(app, '/api/docker/images')).json()) as DockerImageList
    expect(body.totalBytes).toBe(900 * MB)
    const old = body.images.find((image) => image.tags[0] === 'old-app:1')
    expect(old).toMatchObject({ sizeBytes: 120 * MB, uniqueBytes: 100 * MB, containerCount: 0, protection: null })
    const dangling = body.images.find((image) => image.dangling)
    expect(dangling).toMatchObject({ tags: [], protection: null })
    expect(body.images[0]?.sizeBytes).toBeGreaterThanOrEqual(body.images.at(-1)?.sizeBytes ?? 0)
    // Only what is free and unprotected counts: not Traefik's image, not the ones in use.
    expect(body.reclaimableBytes).toBe(100 * MB + 50 * MB)
  })

  it('protects Portta’s images even while the stack is down, and anything a container uses', async () => {
    const { app } = host()
    const body = (await (await get(app, '/api/docker/images')).json()) as DockerImageList
    const by = Object.fromEntries(body.images.map((image) => [image.tags[0] ?? 'dangling', image.protection]))
    expect(by).toMatchObject({
      'traefik:v3.7.12': 'portta',
      'ghcr.io/codions-labs/portta:1.0': 'portta',
      'shop:latest': 'in-use',
      'batch:1': 'in-use',
      'old-app:1': null,
      dangling: null,
    })
  })

  it('removes every tag of an image, and the id of an untagged one', async () => {
    const { app, docker } = host()
    const body = (await (
      await post(app, '/api/docker/images/remove', {
        confirm: true,
        ids: ['sha256:old', 'dangling', 'sha256:traefik', 'shop'],
      })
    ).json()) as DockerResourceRemoveResult
    expect(docker.calls.filter((call) => call.method === 'removeImage').map((call) => call.args[0])).toEqual([
      'old-app:1',
      'dangling',
    ])
    expect(body).toMatchObject({ removed: 2, skipped: 2, freedBytes: 100 * MB + 50 * MB })
  })

  it('never removes an image a container was created from, by id or by prefix', async () => {
    const { app, docker } = host()
    await post(app, '/api/docker/images/remove', { confirm: true, ids: ['shop', 'stopped', 'web'] })
    expect(docker.calls.some((call) => call.method === 'removeImage')).toBe(false)
  })
})

describe('the volumes', () => {
  it('lists sizes, tells anonymous volumes apart and protects Portta’s data', async () => {
    const { app } = host()
    const body = (await (await get(app, '/api/docker/volumes')).json()) as DockerVolumeList
    const by = Object.fromEntries(body.volumes.map((volume) => [volume.name, volume]))
    expect(by.shop_data).toMatchObject({ sizeBytes: 400 * MB, containerCount: 1, protection: 'in-use' })
    // A stopped container still owns its volume.
    expect(by[ANON]).toMatchObject({ anonymous: true, containerCount: 1, protection: 'in-use' })
    expect(by.portta_acme?.protection).toBe('portta')
    // Portta's volume stays protected while nothing mounts it: it is the certificates.
    expect(by.portta_orphan?.protection).toBe('portta')
    expect(by.old_db).toMatchObject({ anonymous: false, protection: null, sizeBytes: 700 * MB })
    expect(by.remote_vol?.sizeBytes).toBeNull()
    expect(body.reclaimableBytes).toBe(700 * MB + 2 * MB)
  })

  it('removes the free ones and refuses the rest', async () => {
    const { app, docker } = host()
    const body = (await (
      await post(app, '/api/docker/volumes/remove', {
        confirm: true,
        ids: ['old_db', 'shop_data', 'portta_orphan', 'portta_acme', ANON],
      })
    ).json()) as DockerResourceRemoveResult
    expect(docker.calls.filter((call) => call.method === 'removeVolume').map((call) => call.args[0])).toEqual([
      'old_db',
    ])
    expect(body).toMatchObject({ removed: 1, skipped: 4, freedBytes: 700 * MB })
  })
})

describe('the prune', () => {
  const sweep = { confirm: true, containers: false, networks: false, images: 'none', volumes: 'none' } as const

  it('says what a sweep would free, counting what stopped containers release', async () => {
    const { app } = host()
    const body = (await (await get(app, '/api/docker/usage')).json()) as DiskUsageSummary
    expect(body.containers).toEqual({ total: 3, stopped: 1 })
    // batch_default only becomes free once its stopped container is gone.
    expect(body.networks.unused).toBe(2)
    expect(body.images).toMatchObject({ dangling: 1, danglingBytes: 50 * MB, unused: 3 })
    expect(body.volumes).toMatchObject({ anonymous: 2, unused: 4 })
    expect(body.buildCacheBytes).toBe(50 * MB)
  })

  it('removes nothing on a dry run, and lists the same things the real run removes', async () => {
    const { app, docker } = host()
    const request = { ...sweep, containers: true, networks: true, images: 'unused', volumes: 'anonymous' }
    const preview = (await (
      await post(app, '/api/docker/prune', { ...request, dryRun: true })
    ).json()) as DockerPruneResult
    expect(docker.calls.some((call) => /^remove/.test(call.method))).toBe(false)
    const real = (await (
      await post(app, '/api/docker/prune', { ...request, dryRun: false })
    ).json()) as DockerPruneResult
    expect(real.items.map((item) => `${item.kind}:${item.id}`).sort()).toEqual(
      preview.items.map((item) => `${item.kind}:${item.id}`).sort(),
    )
  })

  it('sweeps stopped containers first, and then what they were holding', async () => {
    const { app, docker } = host()
    const body = (await (
      await post(app, '/api/docker/prune', {
        ...sweep,
        dryRun: false,
        containers: true,
        networks: true,
        images: 'unused',
        volumes: 'anonymous',
      })
    ).json()) as DockerPruneResult
    expect(
      docker.calls.filter((call) => call.method.startsWith('remove')).map((call) => [call.method, call.args[0]]),
    ).toEqual(
      expect.arrayContaining([
        ['remove', 'c-batch'],
        ['removeNetwork', 'n-batch'],
        ['removeNetwork', 'n-old'],
        ['removeImage', 'old-app:1'],
        ['removeVolume', ANON],
        ['removeVolume', 'b'.repeat(64)],
      ]),
    )
    expect(body.failed).toBe(0)
  })

  it('never sweeps what is Portta’s, Docker’s or in use', async () => {
    const { app, docker } = host()
    await post(app, '/api/docker/prune', {
      confirm: true,
      dryRun: false,
      containers: true,
      networks: true,
      images: 'unused',
      volumes: 'unused',
    })
    const touched = docker.calls.filter((call) => call.method.startsWith('remove')).map((call) => String(call.args[0]))
    for (const kept of [
      'c-web',
      'c-shop',
      'n-bridge',
      'n-host',
      'n-none',
      'n-portta',
      'n-control',
      'n-web',
      'n-shop',
      'traefik:v3.7.12',
      'ghcr.io/codions-labs/portta:1.0',
      'shop:latest',
      'portta_acme',
      'portta_orphan',
      'shop_data',
    ]) {
      expect(touched, kept).not.toContain(kept)
    }
    // Named volumes nothing mounts are only swept when asked for explicitly.
    expect(touched).toContain('old_db')
  })

  it('leaves named volumes alone unless the sweep asks for them', async () => {
    const { app, docker } = host()
    await post(app, '/api/docker/prune', { ...sweep, dryRun: false, volumes: 'anonymous' })
    expect(docker.calls.filter((call) => call.method === 'removeVolume').map((call) => call.args[0])).not.toContain(
      'old_db',
    )
  })

  it('does nothing without a confirmation', async () => {
    const { app, docker } = host()
    expect((await post(app, '/api/docker/prune', { ...sweep, confirm: false, dryRun: false })).status).toBe(400)
    expect(docker.calls.some((call) => call.method.startsWith('remove'))).toBe(false)
  })
})
