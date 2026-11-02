import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptySnapshot, historyPointFrom } from 'portta-core'
import { initialState } from './documentation-host.mjs'

// Owned, synthetic collector output: documentation never reads this host's
// account, metrics, credentials or environment file.
export function documentationState({ mode = 'disabled', profile = 'local' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'portta-docs-'))
  const metricsDir = join(directory, 'metrics')
  const environmentDir = join(directory, 'environment')
  mkdirSync(metricsDir)
  mkdirSync(environmentDir)
  const versionFile = join(directory, 'VERSION')
  writeFileSync(versionFile, '0.2.0\n')
  writeFileSync(join(directory, 'protections.json'), JSON.stringify({ version: 1, protections: [] }), { mode: 0o600 })
  const envFile = join(directory, '.env')
  writeFileSync(
    envFile,
    [
      `PORTTA_PROFILE=${profile}`,
      'PORTTA_DOMAIN=localhost',
      `PORTTA_TCP=${profile !== 'remote-public'}`,
      `PORTTA_AUTH_MODE=${mode}`,
      'PORTTA_AUTH_SECRET=an-end-to-end-secret-long-enough-to-sign',
      `TLS_ENABLED=${profile === 'remote-public'}`,
      ...(profile === 'remote-public' ? ['PUBLIC_DOMAIN=portta.test', 'PUBLIC_ENABLED=true'] : []),
    ].join('\n'),
    { mode: 0o600 },
  )
  const GiB = 1024 ** 3
  const snapshot = emptySnapshot({ id: 'documentation', name: 'Demo workstation', hostname: 'workstation' }, 1)
  Object.assign(snapshot.host, {
    hostname: 'workstation',
    productName: 'MacBook Pro',
    kind: 'notebook',
    architecture: 'arm64',
    platform: 'darwin',
    distro: 'macOS',
    version: '15.7',
    uptimeSeconds: 6 * 86400,
    cpu: {
      manufacturer: 'Apple',
      brand: 'Apple M3 Pro',
      physicalCores: 10,
      logicalCores: 10,
      speed: 3.5,
      speedMax: 4.1,
    },
    memoryTotalBytes: 32 * GiB,
    memoryUsedBytes: 12 * GiB,
    memoryAvailableBytes: 20 * GiB,
    memoryUsedPercent: 0.375,
    swapTotalBytes: 2 * GiB,
    swapUsedBytes: 0,
    cpuUtilisation: 0.18,
    cpuIdle: 0.82,
    load: { one: 1.8, five: 1.5, fifteen: 1.2 },
    storage: {
      path: '/',
      mount: '/',
      filesystem: 'apfs',
      totalBytes: 512 * GiB,
      usedBytes: 208 * GiB,
      availableBytes: 304 * GiB,
      usedPercent: 208 / 512,
    },
    temperatureCelsius: 49,
    battery: {
      hasBattery: true,
      percent: 0.84,
      charging: true,
      acConnected: true,
      minutesRemaining: null,
      cycleCount: 82,
    },
  })
  snapshot.runtime = { name: 'orbstack' }
  const projects = new Map()
  for (const container of initialState()) {
    const labels = container.item.Labels
    const project = labels['com.docker.compose.project']
    if (!labels['portta.project'] || !project) continue
    const resources = projects.get(project) ?? []
    const memory = (labels['com.docker.compose.service'] === 'postgres' ? 384 : 128) * 1024 ** 2
    resources.push({
      id: container.id,
      name: container.item.Names[0].slice(1),
      service: labels['com.docker.compose.service'],
      cpuUtilisation: 0.02,
      memoryUsedBytes: memory,
      memoryLimitBytes: 2 * GiB,
      memoryUsedPercent: memory / (2 * GiB),
      networkRxBytes: 204800,
      networkTxBytes: 102400,
      blockReadBytes: 409600,
      blockWriteBytes: 204800,
      pids: 12,
    })
    projects.set(project, resources)
  }
  snapshot.projects = [...projects].map(([name, containers]) => ({
    id: name,
    name,
    composeProject: name,
    containers,
    containerCount: containers.length,
    cpuUtilisation: containers.length * 0.02,
    memoryUsedBytes: containers.reduce((total, container) => total + container.memoryUsedBytes, 0),
    networkRxBytes: 204800,
    networkTxBytes: 102400,
  }))
  const refresh = () => {
    snapshot.collectedAt = Math.floor(Date.now() / 1000)
    writeFileSync(join(metricsDir, 'current.json'), JSON.stringify(snapshot))
    const history = Array.from({ length: 120 }, (_, index) => {
      const point = historyPointFrom(snapshot)
      point.timestamp = snapshot.collectedAt - (119 - index) * 15
      point.host.cpuUtilisation = 0.15 + Math.sin(index / 8) * 0.04
      return JSON.stringify(point)
    })
    writeFileSync(join(metricsDir, 'history.jsonl'), `${history.join('\n')}\n`)
    writeFileSync(
      join(environmentDir, 'report.json'),
      JSON.stringify({
        version: 1,
        collectedAt: snapshot.collectedAt,
        durationMs: 428,
        checks: [
          {
            id: 'docker',
            category: 'infrastructure',
            status: 'pass',
            title: 'Docker Engine',
            detail: '29.4.0 · OrbStack · aarch64',
            fix: '',
          },
          {
            id: 'compose',
            category: 'infrastructure',
            status: 'pass',
            title: 'Docker Compose',
            detail: 'Compose v2 is available',
            fix: '',
          },
          {
            id: 'node',
            category: 'development',
            status: 'pass',
            title: 'Node.js',
            detail: '24.18.0 · required 24 or later',
            fix: '',
          },
          {
            id: 'git',
            category: 'development',
            status: 'pass',
            title: 'Git',
            detail: 'Installed and ready for worktrees',
            fix: '',
          },
          {
            id: 'agent-guidelines',
            category: 'agents',
            status: 'pass',
            title: 'Shared-host guidelines',
            detail: 'AGENTS.md is available in the checkout',
            fix: '',
          },
        ],
      }),
    )
  }
  refresh()
  const timer = setInterval(refresh, 5000)
  return {
    env: {
      PORTTA_TCP: String(profile !== 'remote-public'),
      PORTTA_E2E_PROFILE: profile,
      PORTTA_E2E_STATE: directory,
      PORTTA_E2E_ENV_FILE: envFile,
      PORTTA_RUNTIME_METRICS_DIR: metricsDir,
      PORTTA_RUNTIME_ENVIRONMENT_DIR: environmentDir,
      PORTTA_RUNTIME_VERSION_FILE: versionFile,
      PORTTA_E2E_VERSION: '0.2.0',
    },
    close() {
      clearInterval(timer)
      rmSync(directory, { recursive: true, force: true })
    },
  }
}
