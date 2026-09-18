import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { changedFiles } from './lib/affected.mjs'
import { ciScope } from './lib/ci-scope.mjs'
import { root } from './lib/execution.mjs'

const mode = process.env.PORTTA_CI_MODE || 'pr'
const base = process.env.PORTTA_CI_BASE
// A force-push can name a base that is not in this history: treat it as unknown.
function changed() {
  if (!base || /^0+$/.test(base)) return undefined
  try {
    return changedFiles(root, base)
  } catch {
    return undefined
  }
}
const files = changed()
const known = files !== undefined

// Only a changed runtime dependency of a workspace reaches E2E; lockfile churn,
// scripts and devDependencies are covered by the static and unit jobs.
function dependencyChanges() {
  const reference = execFileSync('git', ['merge-base', 'HEAD', base], { cwd: root, encoding: 'utf8' }).trim()
  const dependencies = (read) => {
    try {
      return JSON.stringify(JSON.parse(read()).dependencies ?? {})
    } catch {
      return undefined
    }
  }
  return files
    .filter((file) => /^(apps|packages)\/[^/]+\/package\.json$/.test(file))
    .filter(
      (file) =>
        dependencies(() =>
          execFileSync('git', ['show', `${reference}:${file}`], {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          }),
        ) !== dependencies(() => readFileSync(join(root, file), 'utf8')),
    )
}

const scope = ciScope(files, mode, known && mode === 'pr' ? dependencyChanges() : [])
console.log(JSON.stringify(scope, null, 2))
if (process.env.GITHUB_OUTPUT) {
  const shards = scope.shards.map(({ name, suites }) => ({ name, suites: suites.join(',') }))
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `code=${scope.code}\nmode=${scope.mode}\ndocs=${scope.docs}\ngateway=${scope.gateway.join(',')}\nbrowser=${scope.browser.join(',')}\ngateway_shards=${JSON.stringify(shards)}\n`,
  )
}
