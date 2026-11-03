// The files of a project are read from the copy the collector published, and only what that copy
// says is readable: the panel never builds a path from a request.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileKey, type PublishedFiles } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { listAudit } from '../src/services/audit.ts'
import { makeApp, seededDatabase } from './helpers.ts'

const file = (path: string, over: Partial<PublishedFiles['files'][number]> = {}): PublishedFiles['files'][number] => ({
  path,
  kind: 'file',
  size: 10,
  status: null,
  ignored: false,
  readable: 'text',
  diff: false,
  ...over,
})

async function panel() {
  const seeded = await seededDatabase()
  await seeded.database.projects.setEnvironments(seeded.ids.project, ['alpha'])
  const dir = mkdtempSync(join(tmpdir(), 'portta-project-files-'))
  const base = join(dir, 'alpha')
  mkdirSync(join(base, 'blobs'), { recursive: true })
  mkdirSync(join(base, 'diffs'), { recursive: true })
  const index: PublishedFiles = {
    version: 1,
    environment: 'alpha',
    branch: 'develop',
    head: { hash: 'a41f2c9', subject: 'first', at: 1_700_000_000 },
    changed: 1,
    untracked: 0,
    ahead: 2,
    collectedAt: 1_700_000_100,
    truncated: false,
    files: [
      file('src/app.ts', { status: 'M', diff: true }),
      file('.env', { readable: 'hidden' }),
      file('node_modules', { kind: 'dir', ignored: true, readable: 'omitted' }),
      file('logo.png', { readable: 'binary' }),
    ],
  }
  writeFileSync(join(base, 'index.json'), JSON.stringify(index))
  writeFileSync(join(base, 'blobs', fileKey('src/app.ts')), 'export const one = 2\n')
  writeFileSync(join(base, 'diffs', fileKey('src/app.ts')), '-one = 1\n+one = 2\n')
  // What a careless collector or somebody with write access might leave behind.
  writeFileSync(join(base, 'blobs', fileKey('.env')), 'TOKEN=leaked')
  const { app } = makeApp({}, { filesDir: dir }, seeded.database)
  const get = (path: string) => app.request(path)
  return { get, seeded }
}

const content = (path: string, environment = 'alpha') =>
  `/api/projects/produto/files/content?environment=${environment}&path=${encodeURIComponent(path)}`

describe('listing the files of a project', () => {
  it('says where the code stands and lists what the copy holds, ignored folders included', async () => {
    const { get } = await panel()
    const response = await get('/api/projects/produto/files')
    expect(response.status).toBe(200)
    const view = (await response.json()) as Record<string, any>
    expect(view).toMatchObject({
      environments: ['alpha'],
      environment: 'alpha',
      branch: 'develop',
      changed: 1,
      ahead: 2,
      head: { hash: 'a41f2c9' },
    })
    expect(view.files.map((entry: { path: string }) => entry.path)).toEqual([
      'src/app.ts',
      '.env',
      'node_modules',
      'logo.png',
    ])
  })

  it('has an empty answer for a project whose files were never published', async () => {
    const seeded = await seededDatabase()
    const { app } = makeApp({}, { filesDir: mkdtempSync(join(tmpdir(), 'portta-empty-')) }, seeded.database)
    const response = await app.request('/api/projects/produto/files')
    expect(await response.json()).toMatchObject({ environments: [], environment: null, files: [] })
  })

  it('answers 404 for a project that does not exist and for an environment that is not its own', async () => {
    const { get } = await panel()
    expect((await get('/api/projects/nobody/files')).status).toBe(404)
    expect((await get('/api/projects/produto/files?environment=beta')).status).toBe(404)
  })
})

describe('reading one file', () => {
  it('gives the text and the changes, and writes it to the audit log', async () => {
    const { get, seeded } = await panel()
    const response = await get(content('src/app.ts'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      environment: 'alpha',
      path: 'src/app.ts',
      content: 'export const one = 2\n',
      diff: '-one = 1\n+one = 2\n',
    })
    const entries = await listAudit(seeded.db, {})
    expect(entries.entries.some((entry) => entry.action === 'project_file.read')).toBe(true)
  })

  it('never gives a file that usually holds a secret, even when its text is on disk', async () => {
    const { get } = await panel()
    expect((await get(content('.env'))).status).toBe(404)
  })

  it('has no text for an ignored folder, a binary or a path that is not in the listing', async () => {
    const { get } = await panel()
    for (const path of ['node_modules', 'logo.png', 'src/other.ts']) {
      expect((await get(content(path))).status).toBe(404)
    }
  })

  it.each(['../index.json', '../../etc/passwd', '/etc/passwd', 'src//app.ts', 'src/../.env', 'a\\b'])(
    'refuses %s',
    async (path) => {
      const { get } = await panel()
      expect((await get(content(path))).status).toBe(400)
    },
  )

  it('refuses an environment that climbs out of the copy', async () => {
    const { get } = await panel()
    expect((await get(content('src/app.ts', '..'))).status).toBe(404)
    expect((await get(content('src/app.ts', 'alpha/..'))).status).toBe(404)
  })
})
