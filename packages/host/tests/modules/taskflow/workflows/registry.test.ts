// Named-workflow registry: tier precedence (project > user > builtin), meta.name matching,
// walk-up project discovery, skip rules, and the CLI surface (workflows / save / run-by-name).
// Filesystem-touching parts are scoped to temp dirs + a temp PORTTA_HOST_STATE_DIR; the builtin tier
// resolves package-relative so the repo's builtins/ workflows are always visible.

import { strict as assert } from 'node:assert'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, afterEach, before, describe, test } from 'node:test'

import { isUserFacingError } from '../../../../src/modules/taskflow/workflows/cli.ts'
import {
  builtinDir,
  listWorkflows,
  resolveWorkflowName,
  WorkflowNotFoundError,
} from '../../../../src/modules/taskflow/workflows/runtime/registry.ts'
import { runMain } from './run-main.ts'

/** Write a minimal valid workflow claiming `metaName` to dir/filename. */
function writeWorkflow(dir: string, metaName: string, filename = `${metaName}.workflow.js`): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, filename)
  writeFileSync(
    file,
    `export const meta = { name: ${JSON.stringify(metaName)}, description: "test workflow ${metaName}" }\n` +
      `return await agent("say hi")\n`,
  )
  return file
}

/** A temp project root with a .git marker so the walk-up never escapes the temp tree. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'taskflow-registry-proj-'))
  mkdirSync(join(root, '.git'))
  return root
}

describe('registry resolution', () => {
  let home: string
  let project: string
  const savedHome = process.env.PORTTA_HOST_STATE_DIR

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'taskflow-registry-home-'))
    project = makeProject()
    process.env.PORTTA_HOST_STATE_DIR = home
  })
  after(() => {
    if (savedHome === undefined) delete process.env.PORTTA_HOST_STATE_DIR
    else process.env.PORTTA_HOST_STATE_DIR = savedHome
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })
  afterEach(() => {
    // Each test writes into these two tiers; reset them so cases stay independent.
    rmSync(join(home, 'workflows'), { recursive: true, force: true })
    rmSync(join(project, '.portta'), { recursive: true, force: true })
  })

  test('matches by meta.name, not filename', () => {
    writeWorkflow(join(home, 'workflows'), 'real-name', 'totally-different-file.js')
    const hit = resolveWorkflowName('real-name', project)
    assert.ok(hit.endsWith('totally-different-file.js'))
    assert.throws(() => resolveWorkflowName('totally-different-file', project), WorkflowNotFoundError)
  })

  test('project beats user beats builtin on the same name', () => {
    const userFile = writeWorkflow(join(home, 'workflows'), 'dupe')
    assert.equal(resolveWorkflowName('dupe', project), userFile)
    const projFile = writeWorkflow(join(project, '.portta', 'workflows'), 'dupe')
    assert.equal(resolveWorkflowName('dupe', project), projFile)

    // Shadow a builtin from the user tier.
    const shadow = writeWorkflow(join(home, 'workflows'), 'deep-research')
    assert.equal(resolveWorkflowName('deep-research', project), shadow)
  })

  test('builtins resolve with empty project/user tiers, regardless of PORTTA_HOST_STATE_DIR', () => {
    const hit = resolveWorkflowName('deep-research', project)
    assert.ok(hit.startsWith(builtinDir()), `expected a builtin path, got ${hit}`)
    assert.ok(resolveWorkflowName('code-review', project).endsWith('code-review.workflow.js'))
  })

  test('walk-up finds a parent .portta/workflows and a nearer dir shadows it', () => {
    const rootFile = writeWorkflow(join(project, '.portta', 'workflows'), 'walk')
    const nested = join(project, 'packages', 'app')
    mkdirSync(nested, { recursive: true })
    assert.equal(resolveWorkflowName('walk', nested), rootFile)

    const nearFile = writeWorkflow(join(nested, '.portta', 'workflows'), 'walk')
    assert.equal(resolveWorkflowName('walk', nested), nearFile)
  })

  test('keeps project discovery when only the builtin directory is overridden', () => {
    const projectFile = writeWorkflow(join(project, '.portta', 'workflows'), 'project-with-assets')

    assert.equal(resolveWorkflowName('project-with-assets', project, { builtinDir: builtinDir() }), projectFile)
  })

  test('walk-up stops at the repo boundary (.git)', () => {
    // A workflow ABOVE the repo root must not be visible from inside it.
    const outer = mkdtempSync(join(tmpdir(), 'taskflow-registry-outer-'))
    try {
      writeWorkflow(join(outer, '.portta', 'workflows'), 'outside')
      const repo = join(outer, 'repo')
      mkdirSync(join(repo, '.git'), { recursive: true })
      assert.throws(() => resolveWorkflowName('outside', repo), WorkflowNotFoundError)
    } finally {
      rmSync(outer, { recursive: true, force: true })
    }
  })

  test('skips invalid-meta and oversize files without crashing', () => {
    const dir = join(home, 'workflows')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.js'), 'this is not a workflow at all {{{\n')
    writeFileSync(
      join(dir, 'huge.js'),
      `export const meta = { name: "huge", description: "too big" }\n// ${'x'.repeat(600_000)}\n`,
    )
    writeWorkflow(dir, 'good')

    const names = listWorkflows(project).map((e) => e.name)
    assert.ok(names.includes('good'))
    assert.ok(!names.includes('huge'), 'oversize file must be skipped')
    assert.throws(() => resolveWorkflowName('huge', project), WorkflowNotFoundError)
  })

  test('miss throws WorkflowNotFoundError listing what IS available', () => {
    writeWorkflow(join(home, 'workflows'), 'present')
    try {
      resolveWorkflowName('absent', project)
      assert.fail('expected WorkflowNotFoundError')
    } catch (err) {
      assert.ok(err instanceof WorkflowNotFoundError)
      assert.match(err.message, /"absent" not found/)
      assert.match(err.message, /present/)
      assert.match(err.message, /deep-research/) // builtins are part of "available"
    }
  })

  test('listWorkflows returns winners only, with tier and description', () => {
    writeWorkflow(join(home, 'workflows'), 'deep-research') // shadows the builtin
    const entries = listWorkflows(project)
    const dr = entries.filter((e) => e.name === 'deep-research')
    assert.equal(dr.length, 1, 'shadowed builtin must not appear twice')
    assert.equal(dr[0]?.tier, 'user')
    assert.equal(dr[0]?.description, 'test workflow deep-research')
    assert.equal(entries.find((e) => e.name === 'code-review')?.tier, 'builtin')
  })
})

describe('registry CLI (workflows / save / run-by-name)', () => {
  let home: string
  let project: string
  const savedHome = process.env.PORTTA_HOST_STATE_DIR
  const savedCwd = process.cwd()

  before(() => {
    home = mkdtempSync(join(tmpdir(), 'taskflow-registry-cli-home-'))
    project = makeProject()
    process.env.PORTTA_HOST_STATE_DIR = home
    process.chdir(project)
  })
  after(() => {
    process.chdir(savedCwd)
    if (savedHome === undefined) delete process.env.PORTTA_HOST_STATE_DIR
    else process.env.PORTTA_HOST_STATE_DIR = savedHome
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  })

  test('save → workflows → run <name> --fake round-trip', async () => {
    const src = writeWorkflow(project, 'roundtrip', 'anything.js')

    const save = await runMain(['save', src])
    assert.match(save.stdout, /saved "roundtrip"/)
    assert.match(save.stdout, /roundtrip\.workflow\.js/)

    const list = await runMain(['workflows', '--json'])
    const entries = JSON.parse(list.stdout) as Array<{ name: string; tier: string; description: string }>
    const hit = entries.find((e) => e.name === 'roundtrip')
    assert.equal(hit?.tier, 'user')
    assert.ok(entries.some((e) => e.name === 'deep-research' && e.tier === 'builtin'))

    const run = await runMain(['run', 'roundtrip', '--fake', '--no-serve', '--json'])
    assert.equal(run.code, 0, `stderr=${run.stderr}`)
    assert.equal(JSON.parse(run.stdout).status, 'completed')

    const validate = await runMain(['validate', 'roundtrip'])
    assert.match(validate.stdout, /ok: "roundtrip"/)
  })

  test('run by name keeps the NAME in the resume hint, not the resolved path', async () => {
    writeWorkflow(join(home, 'workflows'), 'hinted')
    const r = await runMain(['run', 'hinted', '--fake', '--no-serve'])
    assert.equal(r.code, 0, `stderr=${r.stderr}`)
    assert.match(r.stderr, /portta flow workflows run hinted --resume wf_/)
  })

  test('save --project writes into <cwd>/.portta/workflows', async () => {
    const src = writeWorkflow(project, 'proj-saved', 'src.js')
    const r = await runMain(['save', src, '--project'])
    // join() so the assertion holds on Windows path separators too.
    assert.ok(r.stdout.includes(join('.portta', 'workflows', 'proj-saved.workflow.js')), r.stdout)
  })

  test('re-save refuses without --force, succeeds with it', async () => {
    const src = writeWorkflow(project, 'twice', 'twice-src.js')
    await runMain(['save', src])
    await assert.rejects(runMain(['save', src]), (err) => isUserFacingError(err) && /already exists/.test(String(err)))
    await runMain(['save', src, '--force'])
  })

  test('save rejects a file with invalid meta, cleanly', async () => {
    const bad = join(project, 'bad.js')
    writeFileSync(bad, `export const meta = { description: "no name" }\nreturn 1\n`)
    await assert.rejects(runMain(['save', bad]), isUserFacingError)
  })

  test("run with a path-looking arg that doesn't exist errors instead of registry lookup", async () => {
    for (const arg of ['./missing.workflow.js', 'missing-dir/wf.js', 'missing.js']) {
      await assert.rejects(runMain(['run', arg, '--fake', '--no-serve']), /workflow file not found/, `arg=${arg}`)
    }
  })
})
