// The Add project pages read what the collector published about the folders under Projects Home,
// and answer only for a folder that is in its list.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DiscoveredFolders, type FolderPlan, fileKey } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { makeApp, seededDatabase } from './helpers.ts'

const plan = (path: string): FolderPlan => ({
  version: 1,
  path,
  composeFile: 'compose.yaml',
  project: { name: 'loja-nova', source: 'directory name (implicit)' },
  domain: 'portta.example',
  adopted: false,
  services: [
    { name: 'web', image: 'nginx', kind: 'http', port: '3000', publishedPorts: [], containerName: null },
    {
      name: 'postgres',
      image: 'postgres',
      kind: 'datastore',
      port: null,
      publishedPorts: [{ host: '5432', container: '5432' }],
      containerName: 'loja-db',
    },
  ],
  findings: {
    publishedHostPorts: ['postgres'],
    fixedContainerNames: ['postgres'],
    publishedDatastores: ['postgres'],
    implicitNamespace: true,
    containerNameCollisions: [],
    namespaceInUse: null,
  },
  collectedAt: 1_700_000_000,
})

async function panel(options: { publish?: boolean } = {}) {
  const seeded = await seededDatabase({ empty: true })
  const dir = mkdtempSync(join(tmpdir(), 'portta-discovery-'))
  if (options.publish !== false) {
    mkdirSync(join(dir, 'plans'), { recursive: true })
    const index: DiscoveredFolders = {
      version: 1,
      home: '/home/ada/projects',
      collectedAt: 1_700_000_100,
      folders: [
        { path: 'loja-nova', composeFile: 'compose.yaml', services: 2, modifiedAt: 1, adopted: false, planned: true },
        { path: 'blog', composeFile: 'compose.yaml', services: null, modifiedAt: 1, adopted: false, planned: false },
      ],
    }
    writeFileSync(join(dir, 'folders.json'), JSON.stringify(index))
    writeFileSync(join(dir, 'plans', fileKey('loja-nova')), JSON.stringify(plan('loja-nova')))
    // What a careless collector or somebody with write access might leave behind.
    writeFileSync(join(dir, 'plans', fileKey('../etc')), JSON.stringify(plan('../etc')))
  }
  const { app } = makeApp({}, { discoveryDir: dir }, seeded.database)
  return { get: (path: string) => app.request(path), app, seeded }
}

describe('the folders the collector found', () => {
  it('lists them with what is known, and says which already have a project', async () => {
    const { app } = await panel()
    await app.request('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ slug: 'loja', name: 'Loja', relativePath: 'loja-nova' }),
      headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost' },
    })
    const view = (await (await app.request('/api/discovery/folders')).json()) as Record<string, any>
    expect(view).toMatchObject({ home: '/home/ada/projects', collectedAt: 1_700_000_100 })
    expect(view.folders).toMatchObject([
      { path: 'loja-nova', planned: true, registered: true },
      { path: 'blog', planned: false, registered: false },
    ])
  })

  it('says there is nothing when the collector has not published', async () => {
    const { get } = await panel({ publish: false })
    expect(await (await get('/api/discovery/folders')).json()).toEqual({ home: null, collectedAt: null, folders: [] })
  })
})

describe('what adopting a folder would do', () => {
  it('gives the plan and the terminal command that adopts it', async () => {
    const { get } = await panel()
    const response = await get('/api/discovery/plan?path=loja-nova')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      path: 'loja-nova',
      services: [{ name: 'web', port: '3000' }, { name: 'postgres' }],
      findings: { publishedDatastores: ['postgres'] },
      command: 'portta adopt ~/projects/loja-nova',
    })
  })

  it('has no plan for a folder that was listed but not analysed, or that is not listed', async () => {
    const { get } = await panel()
    expect((await get('/api/discovery/plan?path=blog')).status).toBe(404)
    expect((await get('/api/discovery/plan?path=outro')).status).toBe(404)
  })

  it.each(['../etc', '/etc', 'a//b', '.hidden', 'a\\b', ''])('refuses %j before looking for it', async (path) => {
    const { get } = await panel()
    expect((await get(`/api/discovery/plan?path=${encodeURIComponent(path)}`)).status).toBe(400)
  })
})
