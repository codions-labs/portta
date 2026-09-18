import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowCatalogService } from '../services/workflow-catalog-service.ts'

const createdDirectories: string[] = []

afterEach(async (): Promise<void> => {
  await Promise.all(createdDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'taskflow-workflow-catalog-'))
  createdDirectories.push(root)
  return root
}

async function writeWorkflow(
  directory: string,
  name: string,
  description: string,
  filename: string = `${name}.workflow.js`,
  body: string = 'return null',
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const path = join(directory, filename)
  await nodeTest.write(
    path,
    `export const meta = { name: ${JSON.stringify(name)}, description: ${JSON.stringify(description)} }\n${body}\n`,
  )
  return path
}

async function createCatalog(): Promise<{
  catalog: WorkflowCatalogService
  builtinRoot: string
  taskflowHome: string
  projectRoot: string
}> {
  const root = await createRoot()
  const builtinRoot = join(root, 'builtins')
  const taskflowHome = join(root, 'taskflow-home')
  const projectRoot = join(root, 'project')
  return {
    catalog: new WorkflowCatalogService({
      builtinRoot,
      taskflowHome,
      projectRoot,
      engineVersion: 'engine-test',
      keyVersion: 'v-test',
    }),
    builtinRoot,
    taskflowHome,
    projectRoot,
  }
}

describe('WorkflowCatalogService', () => {
  it('uses explicit roots, applies precedence, and exposes shadows', async (): Promise<void> => {
    const { catalog, builtinRoot, taskflowHome, projectRoot } = await createCatalog()
    const builtin = await writeWorkflow(builtinRoot, 'review', 'builtin review')
    const global = await writeWorkflow(join(taskflowHome, 'workflows'), 'review', 'global review')
    const project = await writeWorkflow(join(projectRoot, '.portta', 'workflows'), 'review', 'project review')

    const discovered = await catalog.discover()
    const resolved = await catalog.resolve('review')

    expect(resolved).toEqual(
      expect.objectContaining({ ok: true, definition: expect.objectContaining({ path: project, origin: 'project' }) }),
    )
    expect(
      discovered.entries.filter((entry) => entry.status === 'shadowed').map((entry) => entry.definition.path),
    ).toEqual([global, builtin])
  })

  it('diagnoses invalid metadata and never evaluates a workflow body', async (): Promise<void> => {
    const { catalog, builtinRoot } = await createCatalog()
    await mkdir(builtinRoot, { recursive: true })
    await nodeTest.write(
      join(builtinRoot, 'invalid.workflow.js'),
      "export const meta = { name: 'missing description' }\nthrow new Error('body executed')\n",
    )
    await writeWorkflow(builtinRoot, 'safe', 'does not execute', 'safe.workflow.js', "throw new Error('body executed')")

    const discovered = await catalog.discover()
    const resolved = await catalog.resolve('safe')

    expect(discovered.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_workflow', path: join(builtinRoot, 'invalid.workflow.js') }),
      ]),
    )
    expect(resolved).toEqual(
      expect.objectContaining({ ok: true, definition: expect.objectContaining({ name: 'safe' }) }),
    )
  })

  it('rejects same-tier collisions while preserving lower-tier shadows', async (): Promise<void> => {
    const { catalog, builtinRoot, taskflowHome } = await createCatalog()
    await writeWorkflow(builtinRoot, 'duplicate', 'builtin duplicate')
    await writeWorkflow(join(taskflowHome, 'workflows'), 'duplicate', 'global first', 'a.workflow.js')
    await writeWorkflow(join(taskflowHome, 'workflows'), 'duplicate', 'global second', 'b.workflow.js')

    const discovered = await catalog.discover()
    const resolved = await catalog.resolve('duplicate')

    expect(discovered.entries.filter((entry) => entry.status === 'collision')).toHaveLength(2)
    expect(discovered.entries.filter((entry) => entry.status === 'shadowed')).toHaveLength(1)
    expect(resolved).toEqual(
      expect.objectContaining({ ok: false, diagnostic: expect.objectContaining({ code: 'duplicate_definition' }) }),
    )
  })

  it('freezes source, hash, metadata, and key version for a Run', async (): Promise<void> => {
    const { catalog, projectRoot } = await createCatalog()
    const directory = join(projectRoot, '.portta', 'workflows')
    const path = await writeWorkflow(directory, 'frozen', 'first version')

    const snapshotResult = await catalog.createSnapshot({
      id: 'snapshot_01',
      runId: 'run_01',
      name: 'frozen',
      createdAt: '2026-09-09T12:00:00.000Z',
    })
    expect(snapshotResult.ok).toBe(true)
    if (!snapshotResult.ok) return
    await writeWorkflow(directory, 'frozen', 'second version')
    const current = await catalog.resolve('frozen')

    expect(snapshotResult.snapshot.path).toBe(path)
    expect(snapshotResult.snapshot.source).toContain('first version')
    expect(snapshotResult.snapshot.keyVersion).toBe('v-test')
    expect(snapshotResult.snapshot.metadata).toEqual(expect.objectContaining({ keyVersion: 'v-test' }))
    expect(current.ok).toBe(true)
    if (!current.ok) return
    expect(current.definition.contentHash).not.toBe(snapshotResult.snapshot.contentHash)
  })

  it('allows bake-off snapshots now that fork leases own write isolation', async (): Promise<void> => {
    const { catalog, builtinRoot } = await createCatalog()
    await writeWorkflow(builtinRoot, 'bake-off', 'uses Taskflow fork leases')

    const resolved = await catalog.resolve('bake-off')
    const snapshot = await catalog.createSnapshot({
      id: 'snapshot_01',
      runId: 'run_01',
      name: 'bake-off',
      createdAt: '2026-09-09T12:00:00.000Z',
    })

    expect(resolved).toEqual(
      expect.objectContaining({ ok: true, definition: expect.objectContaining({ name: 'bake-off' }) }),
    )
    expect(snapshot).toEqual(
      expect.objectContaining({ ok: true, snapshot: expect.objectContaining({ name: 'bake-off' }) }),
    )
  })
})
