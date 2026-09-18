import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { reportDir, root, runStep } from './lib/execution.mjs'
import { parseOptions, workspaces } from './lib/runner-options.mjs'

const options = parseOptions(process.argv.slice(2))
if (options.mode === 'help') {
  console.log(`Portta validation (Node 24+ required)
  --integration / no args  static checks, shell, workspaces, types, OpenAPI, schema
    --part static         only the checks that are not workspace tests (CI static job)
    --workspaces A,B      only these workspace test suites (CI unit shards)
  --lint                  static checks including Compose; no containers
  --e2e [--suite NAME | --spec FILE.spec.ts]  isolated gateway/browser only
  --release               integration + build + isolated gateway/browser E2E
Use npm test --workspace=NAME -- path/to/file.test.ts for ordinary development.`)
  process.exit(0)
}
for (const notice of options.notices) console.log(notice)
let passed = true
async function step(label, command, args, extra) {
  const ok = await runStep(label, command, args, extra)
  passed = ok && passed
  return ok
}
const integration = ['integration', 'release'].includes(options.mode)
const checks = integration && !options.workspaces
const tested = integration && !options.part ? (options.workspaces ?? workspaces) : []
if (integration && !existsSync(join(root, 'node_modules'))) throw new Error('node_modules missing: run npm ci')
if (checks) {
  if (!(await step('required tool docker', 'docker', ['compose', 'version']))) process.exit(1)
  // Shipped-entrypoint smoke must use this checkout's output.
  for (const name of ['portta-core', '@codions/portta']) {
    if (!(await step(`build prerequisite ${name}`, 'npm', ['run', 'build', `--workspace=${name}`]))) process.exit(1)
  }
}
if (checks || options.mode === 'lint') await step('static checks', 'bash', ['tests/lint.sh'])
if (checks) {
  await step('test tooling', 'npm', ['run', 'test:tooling'])
  for (const file of readdirSync(join(root, 'tests/unit'))
    .filter((file) => file.endsWith('.test.sh'))
    .sort())
    await step(file, 'bash', [`tests/unit/${file}`])
}
for (const name of tested) await step(name, 'npm', ['test', `--workspace=${name}`, '--'], { vitest: true })
if (checks) {
  for (const name of workspaces) await step(`types ${name}`, 'npm', ['run', 'typecheck', `--workspace=${name}`])
  await step('OpenAPI', 'npm', ['run', 'openapi:check', '--workspace=portta-contracts'])
  await step('Taskflow OpenAPI', 'npm', ['run', 'openapi:taskflow:check', '--workspace=portta-contracts'])
  await step('schema', 'npm', ['run', 'db:check', '--workspace=portta-db'])
}
if (['e2e', 'release'].includes(options.mode) && passed) {
  if (!options.spec)
    await step('gateway E2E', process.execPath, [
      'tests/gateway-e2e.mjs',
      ...(options.suite ? ['--suite', options.suite] : []),
    ])
  if (!options.suite)
    await step('browser E2E', 'npm', [
      'run',
      'test:e2e',
      '--workspace=portta-web',
      '--',
      ...(options.spec ? [options.spec] : []),
    ])
}
console.log(
  `\n${passed ? 'Selected validation passed; see reports for conditional skips.' : 'Validation failed.'}\nReports: ${reportDir}`,
)
process.exitCode = passed ? 0 : 1
