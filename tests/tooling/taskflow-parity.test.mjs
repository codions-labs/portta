// Taskflow parity: every route of the host contract is reachable from the panel.
//
// The panel forwards Taskflow to the host daemon through a table of routes and
// permissions (packages/server/src/modules/taskflow/routes.ts), and the
// dashboard calls them through apps/web/modules/taskflow/lib/api. A route added
// to the contract and forgotten in either place is a feature the CLI has and the
// panel silently does not, so this fails until it is named in both — or named
// here, with the reason the panel has no use for it.

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const apiDirectory = join(root, 'apps/web/modules/taskflow/lib/api')

/** Contract routes only the CLI or the MCP server call, each with the reason the panel does not. */
const CLI_ONLY = {}

/**
 * The contract and the forwarding table, read by a Node that resolves the
 * workspaces' TypeScript sources, the way the OpenAPI generator reads them.
 */
function load() {
  const script = `
    const { apiContract } = await import(${JSON.stringify(pathToFileURL(join(root, 'packages/contracts/src/taskflow/contract.ts')).href)})
    const table = await import(${JSON.stringify(pathToFileURL(join(root, 'packages/server/src/modules/taskflow/routes.ts')).href)})
    process.stdout.write(JSON.stringify({
      contract: Object.entries(apiContract).map(([key, route]) => ({ key, method: route.method, path: route.path })),
      routes: table.TASKFLOW_ROUTES,
      global: [...table.TASKFLOW_GLOBAL_ROUTES],
      extra: table.TASKFLOW_EXTRA_ROUTES,
    }))
  `
  return JSON.parse(
    execFileSync(process.execPath, ['--conditions=development', '--input-type=module', '-e', script], {
      cwd: root,
      encoding: 'utf8',
    }),
  )
}

const { contract, routes, global, extra } = load()
/** A call of the route's client method, however the chain is wrapped across lines. */
const called = (key) => new RegExp(`\\b(?:contract|registryApi)\\s*\\.\\s*${key}\\(`).test(consumers)

const consumers = readdirSync(apiDirectory)
  .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
  .map((name) => readFileSync(join(apiDirectory, name), 'utf8'))
  .join('\n')

test('every contract route has a permission in the panel proxy, at the path the daemon serves it', () => {
  const missing = contract.filter(({ key, method, path }) => {
    const pattern = global.includes(key) ? path : `/:prefix${path}`
    return !routes.some(
      (route) => route.key === key && route.method === method && route.pattern === pattern && route.permission,
    )
  })
  assert.deepEqual(
    missing.map(({ key }) => key),
    [],
    'name these routes in packages/server/src/modules/taskflow/routes.ts',
  )
})

test('every contract route has a caller in the dashboard API, or a reason it has none', () => {
  const uncalled = contract.filter(({ key }) => !Object.hasOwn(CLI_ONLY, key)).filter(({ key }) => !called(key))
  assert.deepEqual(
    uncalled.map(({ key }) => key),
    [],
    'call these from apps/web/modules/taskflow/lib/api, or add them to CLI_ONLY with a reason',
  )
})

test('the allowlist names only contract routes the dashboard really does not call', () => {
  const keys = new Set(contract.map(({ key }) => key))
  for (const [key, reason] of Object.entries(CLI_ONLY)) {
    assert.ok(keys.has(key), `${key} is not a contract route`)
    assert.ok(typeof reason === 'string' && reason.trim() !== '', `${key} needs a reason`)
    assert.ok(!called(key), `${key} is called by the dashboard; remove it from CLI_ONLY`)
  }
})

test('every stream, upload and terminal route the proxy forwards is one the dashboard uses', () => {
  // `/api/runs/:runId/stream` is used when both of its literal pieces are in the calls.
  const unused = extra.filter(
    ({ path }) =>
      !path
        .split(/\/:\w+/)
        .filter(Boolean)
        .every((piece) => consumers.includes(piece)),
  )
  assert.deepEqual(
    unused.map(({ method, path }) => `${method} ${path}`),
    [],
  )
})
