export const allGateway = ['adoption', 'apply', 'lifecycle', 'local-tls', 'tcp-access', 'tcp-routing', 'web-panel']
export const allBrowser = ['panel', 'infrastructure', 'auth', 'roles', 'settings']
// Each shard gets its own disposable host; every suite belongs to exactly one.
export const gatewayShards = [
  ['lifecycle', 'apply', 'web-panel', 'local-tls'],
  ['tcp-routing', 'tcp-access', 'adoption'],
]

// Paths a gateway suite actually exercises. Root manifests,
// scripts/ and publication workflows are covered by the static and unit jobs.
const gatewayRules = [
  [
    /^(tests\/docker\/|tests\/gateway-e2e|tests\/lib\/(require-disposable|assert\.sh|runtime\.sh)|tests\/run\.|\.github\/workflows\/validation\.yaml$)/,
    ['lifecycle'],
  ],
  [/^(bin\/|docker\/compose\/(compose|profiles\/local)\.yaml$)/, ['lifecycle']],
  [/^packages\/cli\/src\/commands\/(lifecycle|network)/, allGateway],
  [/^docker\/images\/toolbox\//, ['tcp-access', 'tcp-routing']],
  [/^docker\/images\/apply\/|^packages\/core\/src\/apply/, ['apply']],
  [/^docker\/compose\/features\/web|^apps\/web\/Dockerfile$|^packages\/cli\/src\/commands\/web/, ['web-panel']],
  [/^docker\/compose\/features\/tcp/, ['tcp-routing']],
  [/^docker\/compose\/profiles\/local-tls|^packages\/cli\/src\/commands\/tls/, ['local-tls']],
  [/^packages\/core\/src\/(discovery|endpoints|hostname|inventory)/, ['tcp-access', 'tcp-routing']],
  [/^packages\/cli\/src\/commands\/(compose-runtime|projects)/, ['adoption']],
  [/^packages\/cli\/src\/commands\/access/, ['tcp-access']],
  [/^(packages\/db\/|packages\/core\/src\/(config|profiles|runner|database))/, ['web-panel', 'lifecycle']],
]

// files: the changed paths, or undefined when the base is unknown.
// dependencyChanges: workspace manifests whose runtime dependencies changed.
export function ciScope(files, mode = 'pr', dependencyChanges = []) {
  if (!['light', 'pr', 'release'].includes(mode)) throw new Error(`Unknown CI mode: ${mode}`)
  const code = mode === 'release' || !files || files.some((file) => !/^(docs\/|[A-Z]+\.md$)/.test(file))
  const docs = mode === 'release' || !files || files.some((file) => /^(docs\/|[A-Z]+\.md$)/.test(file))
  const browser = new Set(),
    gateway = new Set()
  const add = (set, names) => {
    for (const name of names) set.add(name)
  }
  if (mode === 'release') {
    add(gateway, allGateway)
    add(browser, allBrowser)
  } else if (mode !== 'light' && !files) {
    gateway.add('lifecycle')
    browser.add('panel')
  } else if (mode !== 'light') {
    for (const file of files) {
      const spec = /^apps\/web\/e2e\/(\w+)\.spec\.ts$/.exec(file)
      const suite = /^tests\/e2e\/([\w-]+)\.test\.sh$/.exec(file)
      if (spec) browser.add(spec[1])
      if (suite) gateway.add(suite[1])
      for (const [pattern, names] of gatewayRules) if (pattern.test(file)) add(gateway, names)
      if (
        /^(packages\/auth\/|apps\/auth\/|apps\/web\/lib\/.*auth|packages\/server\/src\/(api\/.*(?:auth|users|security)|realtime\/))/.test(
          file,
        )
      )
        add(browser, ['auth', 'roles', 'settings'])
      if (/^apps\/web\/(server\/|playwright\.|e2e\/.*\.(?:mjs|ts)$)/.test(file) && !spec) add(browser, allBrowser)
      if (/^apps\/web\/app\/.*(?:layout|page)\.tsx$/.test(file)) browser.add('panel')
      if (file === '.github/workflows/validation.yaml') browser.add('panel')
    }
    for (const manifest of dependencyChanges) {
      if (/^(apps\/web|packages\/(core|contracts|db|auth|server))\/package\.json$/.test(manifest)) {
        add(browser, allBrowser)
        gateway.add('web-panel')
      }
      if (/^packages\/(core|cli)\/package\.json$/.test(manifest)) gateway.add('lifecycle')
    }
  }
  const shards = gatewayShards
    .map((suites, index) => ({ name: `shard-${index + 1}`, suites: suites.filter((suite) => gateway.has(suite)) }))
    .filter((shard) => shard.suites.length)
  return { code, docs, mode, browser: [...browser].sort(), gateway: [...gateway].sort(), shards }
}
