import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export function changedFiles(root, base) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
  const reference = base ? git('merge-base', 'HEAD', base).trim() : 'HEAD'
  // --no-renames includes both paths of a rename, including staged removals.
  return [
    ...new Set(
      [
        ...git('diff', '--name-only', '--no-renames', '-z', reference, '--').split('\0'),
        ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0'),
      ].filter(Boolean),
    ),
  ].sort()
}

function filesIn(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', '.next', '.git'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  })
}

export function selectTests(root, files) {
  const workspaces = [
    'packages/core',
    'packages/contracts',
    'packages/mcp',
    'packages/db',
    'packages/auth',
    'packages/cli',
    'packages/host',
    'apps/auth',
    'packages/server',
    'apps/web',
  ].map((path) => ({
    path,
    ...JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')),
  }))
  const actions = new Map(),
    gaps = [],
    recommendations = new Set()
  const add = (key, action, reason) => {
    if (!actions.has(key)) actions.set(key, { ...action, reasons: [] })
    actions.get(key).reasons.push(reason)
  }
  const shell = (subject, reason) => {
    const path = `tests/unit/${subject}.test.sh`
    if (existsSync(join(root, path))) add(path, { kind: 'shell', path }, reason)
    else gaps.push(`${reason}: no shell suite mapped`)
  }
  const workspace = (w, reason, filter) => {
    const project = w.path === 'apps/web' && filter ? /^tests\/(ui|logic|server|docs)\//.exec(filter)?.[1] : undefined
    add(`${w.name}:${filter ?? '*'}`, { kind: 'vitest', workspace: w.name, filter, project }, reason)
  }
  for (const file of files) {
    if (/^(tooling\/docs\.mjs$|docs\/|skills\/|README\.md$|CHANGELOG\.md$|CLAUDE\.md$|AGENTS\.md$)/.test(file)) {
      add('docs', { kind: 'command', command: ['npm', 'run', 'docs:check'] }, file)
      continue
    }
    if (file === 'biome.json') {
      add('check', { kind: 'command', command: ['npm', 'run', 'check'] }, file)
      continue
    }
    // Nothing runs against the licence text.
    if (file === 'LICENSE') continue
    if (
      /^(package(?:-lock)?\.json|tsconfig.*|\.github\/|tests\/(run\.|lib\/|tooling\/|docker\/)|justfile|\.dockerignore|\.nvmrc$|\.gitignore$|\.editorconfig$)/.test(
        file,
      )
    ) {
      gaps.push(`${file}: integration/build configuration; run test:integration`)
      continue
    }
    const w = workspaces.find((item) => file.startsWith(`${item.path}/`))
    if (w) {
      const relative = file.slice(w.path.length + 1)
      if (/^(e2e\/|playwright\.)/.test(relative)) {
        recommendations.add('Run the affected browser spec with test:e2e --spec')
        continue
      }
      if (/(Dockerfile|package\.json|config\.|scripts\/)/.test(relative)) {
        gaps.push(`${file}: workspace configuration/build; validate its build and integration`)
        continue
      }
      const ownTest = /\.test\.tsx?$/.test(relative)
      const candidates =
        ownTest && existsSync(join(root, file))
          ? [relative]
          : filesIn(join(root, w.path))
              .filter(
                (path) =>
                  basename(path).replace(/\.test\.tsx?$/, '') === basename(file).replace(/\.(tsx?|json)$/, '') &&
                  /\.test\.tsx?$/.test(path),
              )
              .map((path) => path.slice(join(root, w.path).length + 1))
      if (candidates.length) for (const test of candidates) workspace(w, file, test)
      else workspace(w, `${file}: no exact test; owning workspace fallback`)
      if (!ownTest) {
        add(`types:${w.name}`, { kind: 'command', command: ['npm', 'run', 'typecheck', `--workspace=${w.name}`] }, file)
        if (w.name === 'portta-contracts' || /packages\/server\/src\/api\//.test(file))
          add(
            'openapi',
            { kind: 'command', command: ['npm', 'run', 'openapi:check', '--workspace=portta-contracts'] },
            file,
          )
        if (/packages\/db\/(src\/schema\/|drizzle\/)/.test(file))
          add('schema', { kind: 'command', command: ['npm', 'run', 'db:check', '--workspace=portta-db'] }, file)
        if (w.path.startsWith('packages/')) {
          const visited = new Set([w.name])
          for (let previous = 0; previous !== visited.size; ) {
            previous = visited.size
            for (const consumer of workspaces) {
              const deps = { ...consumer.dependencies, ...consumer.devDependencies }
              if (!visited.has(consumer.name) && Object.keys(deps).some((dep) => visited.has(dep))) {
                visited.add(consumer.name)
                workspace(consumer, `${file}: workspace consumer of ${w.name}`)
                add(
                  `types:${consumer.name}`,
                  { kind: 'command', command: ['npm', 'run', 'typecheck', `--workspace=${consumer.name}`] },
                  file,
                )
              }
            }
          }
        }
      }
      continue
    }
    if (/^tests\/unit\/.*\.test\.sh$/.test(file)) {
      shell(basename(file, '.test.sh'), file)
      continue
    }
    if (/^tests\/e2e\//.test(file)) {
      recommendations.add('Run the affected gateway suite on a disposable daemon')
      continue
    }
    // The launcher and the runtime shell have no unit suite: tests/lint.sh
    // checks them statically and the gateway suites exercise them.
    if (file === 'bin/portta' || /^scripts\//.test(file)) {
      gaps.push(`${file}: runtime shell; run tests/lint.sh and test:integration`)
      continue
    }
    if (/^(docker\/|templates\/|config\/|\.env\.example|VERSION$)/.test(file)) {
      recommendations.add(
        'Render the affected Compose combination; run gateway E2E if runtime routing/lifecycle changed',
      )
      continue
    }
    gaps.push(`${file}: no selection rule`)
  }
  // A workspace fallback subsumes narrower selections in the same invocation.
  const broad = new Set([...actions.values()].filter((a) => a.kind === 'vitest' && !a.filter).map((a) => a.workspace))
  return {
    files,
    actions: [...actions.values()].filter((a) => !(a.kind === 'vitest' && a.filter && broad.has(a.workspace))),
    gaps,
    recommendations: [...recommendations],
  }
}
