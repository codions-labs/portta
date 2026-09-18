// The OpenAPI document of the Taskflow host API is generated from the routes the
// host registers and committed beside the schemas, so an API change is visible in
// review. `--check` fails when the committed document is stale.
//
// This is the one place the contract package reaches for the host, and it is a
// script rather than source: `packages/contracts/src` never imports it, so the
// dependency does not reach anything the browser or the CLI loads.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTaskflowHostApp } from 'portta-host/taskflow/server/app'
import { generateOpenApi } from 'portta-host/taskflow/server/openapi'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(packageRoot, 'taskflow.openapi.json')
const repositoryRoot = resolve(packageRoot, '../..')
// The same identity as the panel contract: CI injects the release or
// development version, and a checkout falls back to the CLI manifest.
const version: string =
  process.env.PORTTA_BUILD_VERSION ??
  (existsSync(resolve(repositoryRoot, 'VERSION'))
    ? readFileSync(resolve(repositoryRoot, 'VERSION'), 'utf8').trim()
    : JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/cli/package.json'), 'utf8')).version)

// Route registration captures the dependencies but does not call them, so the
// document needs no Project, repository, multiplexer or network.
const app = createTaskflowHostApp({
  projects: {
    get: () => undefined,
    list: () => [],
    register: () => {
      throw new Error('the OpenAPI generator registers no Project')
    },
    remove: () => false,
    inits: () => [],
  },
  hasValidToken: async () => false,
})
const rendered = `${JSON.stringify(await generateOpenApi(app, version), null, 2)}\n`

if (process.argv.includes('--check')) {
  const checkedIn = readFileSync(output, 'utf8')
  if (checkedIn !== rendered) {
    process.stderr.write(
      'packages/contracts/taskflow.openapi.json is stale; run: npm run openapi:taskflow --workspace=portta-contracts\n',
    )
    process.exitCode = 1
  }
} else {
  writeFileSync(output, rendered, 'utf8')
  process.stdout.write(`wrote ${output}\n`)
}
