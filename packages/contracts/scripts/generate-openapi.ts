// The OpenAPI document is generated from the routes and committed beside the
// schemas, so an API change is visible in review. The release runner checks it with
// --check; a stale document fails the suite rather than shipping.
//
// This is the one place the contract package reaches for the server, and it is
// a script rather than source: `packages/contracts/src` never imports it, so
// the dependency does not reach anything the browser or the CLI loads.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSecurityMode } from 'portta-auth-core'
import { type AppDeps, createApi, generateOpenApi, SERVER_MODULES } from 'portta-server'
import { loadConfig } from 'portta-server/config'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(here, '..')
const repositoryRoot = resolve(packageRoot, '../..')
const output = resolve(packageRoot, 'openapi.json')
// CI injects the release or development version. A checkout has no VERSION
// source file, so ordinary contract generation falls back to the CLI manifest.
const version =
  process.env.PORTTA_BUILD_VERSION ??
  (existsSync(resolve(repositoryRoot, 'VERSION'))
    ? readFileSync(resolve(repositoryRoot, 'VERSION'), 'utf8').trim()
    : JSON.parse(readFileSync(resolve(repositoryRoot, 'packages/cli/package.json'), 'utf8')).version)

// Route registration captures the dependencies but does not call them. The
// generator therefore needs only the real resolved config; no Docker call,
// working tree or network is involved in producing the contract.
// `security` is read while the routes register -- it decides whether Better
// Auth's endpoints are mounted -- so it is the one other thing this needs. Open
// mode, because the document is the same either way: what a route needs does
// not depend on how this panel was started.
const deps = {
  config: loadConfig({ gatewayVersion: version }),
  security: resolveSecurityMode({}),
  auth: null,
  // Every registered module: the contract describes what the build contains.
  modules: SERVER_MODULES,
} as unknown as AppDeps
const rendered = `${JSON.stringify(await generateOpenApi(createApi(deps), version), null, 2)}\n`

if (process.argv.includes('--check')) {
  const checkedIn = readFileSync(output, 'utf8')
  if (checkedIn !== rendered) {
    process.stderr.write(
      'packages/contracts/openapi.json is stale; run: npm run openapi --workspace=portta-contracts\n',
    )
    process.exitCode = 1
  }
} else {
  writeFileSync(output, rendered, 'utf8')
  process.stdout.write(`wrote ${output}\n`)
}
