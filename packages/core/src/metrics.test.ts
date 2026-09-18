import { describe, expect, it } from 'vitest'
import {
  aggregateProjects,
  dockerCliStatsToRaw,
  filesystemForPath,
  historyPointFrom,
  mergeHistoryLines,
  normalizeBattery,
  normalizeContainerStats,
  normalizeGpus,
  normalizeHost,
  normalizeTemperature,
  parseDockerPercent,
  parseDockerSize,
  parseHistoryLines,
  percentToUnit,
  ratio,
} from './metrics.ts'

describe('metrics helpers', () => {
  it('computes a used/total ratio and refuses a zero total', () => {
    expect(ratio(18, 36)).toBeCloseTo(0.5)
    expect(ratio(10, 0)).toBeNull()
    expect(ratio(null, 10)).toBeNull()
    expect(percentToUnit(34)).toBeCloseTo(0.34)
  })

  it('picks the filesystem that actually holds the Portta path', () => {
    const mounts = [
      { fs: 'overlay', type: 'overlay', size: 8_000, used: 1_000, available: 7_000, use: 12, mount: '/' },
      { fs: '/dev/nvme0n1p2', type: 'ext4', size: 500_000, used: 432_000, available: 68_000, use: 86, mount: '/Users' },
      { fs: 'tmpfs', type: 'tmpfs', size: 1_000, used: 10, available: 990, use: 1, mount: '/tmp' },
    ]
    const chosen = filesystemForPath('/Users/fabio/Projects/portta', mounts)
    expect(chosen?.mount).toBe('/Users')
    expect(chosen?.filesystem).toBe('/dev/nvme0n1p2')
    expect(chosen?.usedPercent).toBeCloseTo(0.86)
  })

  it('keeps a GPU model and treats missing utilisation as unavailable, not zero', () => {
    const gpus = normalizeGpus({
      controllers: [{ vendor: 'Apple', model: 'Apple M3 Pro', vram: 18 }],
    })
    expect(gpus).toEqual([
      {
        vendor: 'Apple',
        model: 'Apple M3 Pro',
        vramBytes: 18 * 1024 * 1024,
        utilisation: null,
        temperature: null,
      },
    ])
  })

  it('keeps a real GPU utilisation of zero when the field is present', () => {
    expect(
      normalizeGpus({
        controllers: [{ model: 'RTX 4090', vram: 24_576, utilization: 0 }],
      })[0]?.utilisation,
    ).toBe(0)
  })

  it('normalizes host memory from total minus available, not SI used', () => {
    const host = normalizeHost({
      system: { manufacturer: 'Apple Inc.', model: 'MacBook Pro', virtual: false },
      os: { distro: 'macOS', release: '15.4', kernel: '24.4.0', arch: 'arm64', hostname: 'studio' },
      cpu: { manufacturer: 'Apple', brand: 'Apple M3 Pro', physicalCores: 11, cores: 12, speed: 4.05 },
      mem: { total: 36_000, available: 17_600, used: 30_000, swaptotal: 8_000, swapused: 2_100 },
      currentLoad: { currentLoad: 34, currentLoadIdle: 66, avgLoad: 1.2 },
      loadavg: [1.2, 1.1, 0.9],
      time: { uptime: 3600 },
    })
    expect(host.hostname).toBe('studio')
    expect(host.model).toBe('MacBook Pro')
    expect(host.cpu.brand).toBe('Apple M3 Pro')
    expect(host.memoryUsedBytes).toBe(18_400)
    expect(host.memoryUsedPercent).toBeCloseTo(18400 / 36000)
    expect(host.cpuUtilisation).toBeCloseTo(0.34)
    expect(host.swapUsedBytes).toBe(2_100)
  })

  it('parses the human sizes docker stats prints', () => {
    expect(parseDockerSize('1.5MiB')).toBe(1.5 * 1024 * 1024)
    expect(parseDockerSize('8.19kB')).toBeCloseTo(8190)
    expect(parseDockerSize('--')).toBeNull()
    expect(parseDockerPercent('12.34%')).toBeCloseTo(12.34)
    expect(parseDockerPercent('--')).toBeNull()
    const raw = dockerCliStatsToRaw({
      CPUPerc: '8.50%',
      MemUsage: '42.5MiB / 7.654GiB',
      MemPerc: '0.54%',
      NetIO: '1.2kB / 3.4kB',
      BlockIO: '0B / 8.19kB',
      PIDs: '12',
    })
    const stats = normalizeContainerStats(raw, { id: 'a', name: 'api-1', service: 'api' })
    expect(stats.cpuUtilisation).toBeCloseTo(0.085)
    expect(stats.memoryUsedBytes).toBeCloseTo(42.5 * 1024 * 1024)
    expect(stats.pids).toBe(12)
    expect(stats.networkRxBytes).toBeCloseTo(1200)
  })

  it('aggregates containers by Compose project, not by name guessing', () => {
    const api = normalizeContainerStats(
      { cpuPercent: 8, memUsage: 420, memLimit: 1024, memPercent: 41 },
      { id: 'a', name: 'api-1', service: 'api' },
    )
    const postgres = normalizeContainerStats(
      { cpuPercent: 17, memUsage: 2100, memLimit: 4096 },
      { id: 'b', name: 'db-1', service: 'postgres' },
    )
    const other = normalizeContainerStats({ cpuPercent: 3, memUsage: 180 }, { id: 'c', name: 'web-1', service: 'web' })
    const projects = aggregateProjects(
      [api, postgres, other],
      [
        {
          id: 'a',
          name: 'api-1',
          labels: {
            'com.docker.compose.project': 'base',
            'com.docker.compose.service': 'api',
            'portta.project': 'Base Empresarial',
          },
        },
        {
          id: 'b',
          name: 'db-1',
          labels: {
            'com.docker.compose.project': 'base',
            'com.docker.compose.service': 'postgres',
            'portta.project': 'Base Empresarial',
          },
        },
        {
          id: 'c',
          name: 'web-1',
          labels: { 'com.docker.compose.project': 'other', 'com.docker.compose.service': 'web' },
        },
      ],
    )
    expect(projects[0]?.name).toBe('Base Empresarial')
    expect(projects[0]?.containerCount).toBe(2)
    expect(projects[0]?.memoryUsedBytes).toBe(2520)
    expect(projects[0]?.cpuUtilisation).toBeCloseTo(0.25)
    expect(projects[1]?.name).toBe('other')
  })

  it('drops history older than the retention window', () => {
    const now = 1_700_000_000
    const stale = JSON.stringify({ timestamp: now - 4000, host: {}, projects: [], containers: [] })
    const fresh = {
      timestamp: now - 10,
      host: {
        cpuUtilisation: 0.2,
        memoryUsedBytes: 1,
        memoryUsedPercent: 0.1,
        storageUsedPercent: null,
        load: null,
        gpuUtilisation: null,
        temperatureCelsius: null,
      },
      projects: [],
      containers: [],
    }
    const merged = mergeHistoryLines(`${stale}\n`, fresh, now, 3600)
    const points = parseHistoryLines(merged, now - 3600)
    expect(points).toHaveLength(1)
    expect(points[0]?.timestamp).toBe(now - 10)
  })

  it('builds a history point without repeating static hardware', () => {
    const point = historyPointFrom({
      version: 1,
      instance: { id: 'i', name: 'box', hostname: 'box' },
      collectedAt: 50,
      host: {
        ...normalizeHost({}),
        cpuUtilisation: 0.3,
        memoryUsedBytes: 10,
        memoryUsedPercent: 0.2,
        storage: {
          path: '/opt/portta',
          mount: '/',
          filesystem: 'ext4',
          totalBytes: 100,
          usedBytes: 40,
          availableBytes: 60,
          usedPercent: 0.4,
        },
        gpu: [{ vendor: 'NVIDIA', model: 'RTX', vramBytes: 1, utilisation: 0.5, temperature: null }],
      },
      runtime: null,
      projects: [
        {
          id: 'p',
          name: 'p',
          composeProject: 'p',
          cpuUtilisation: 0.1,
          memoryUsedBytes: 4,
          containerCount: 1,
          networkRxBytes: 0,
          networkTxBytes: 0,
          containers: [
            {
              id: 'c',
              name: 'c',
              service: 'api',
              cpuUtilisation: 0.1,
              memoryUsedBytes: 4,
              memoryLimitBytes: null,
              memoryUsedPercent: null,
              networkRxBytes: null,
              networkTxBytes: null,
              blockReadBytes: null,
              blockWriteBytes: null,
              pids: null,
            },
          ],
        },
      ],
    })
    expect(point.timestamp).toBe(50)
    expect(point.host.cpuUtilisation).toBe(0.3)
    expect(point.host.gpuUtilisation).toBe(0.5)
    expect(point.projects[0]?.id).toBe('p')
    expect(JSON.stringify(point)).not.toContain('MacBook')
  })
})

describe('battery and temperature', () => {
  it('reports no battery object at all on a host without one', () => {
    expect(normalizeBattery({ hasBattery: false, percent: 0 })).toBeNull()
    expect(normalizeBattery(undefined)).toBeNull()
  })

  it('normalizes charge to a ratio like every other measurement here', () => {
    const battery = normalizeBattery({
      hasBattery: true,
      percent: 82,
      isCharging: false,
      acConnected: false,
      timeRemaining: 213,
      cycleCount: 154,
    })
    expect(battery).toEqual({
      hasBattery: true,
      percent: 0.82,
      charging: false,
      acConnected: false,
      minutesRemaining: 213,
      cycleCount: 154,
    })
  })

  it('treats charging as mains, for platforms that leave acConnected unset', () => {
    expect(normalizeBattery({ hasBattery: true, percent: 50, isCharging: true })?.acConnected).toBe(true)
  })

  it('drops a sensor reading that cannot be a temperature', () => {
    expect(normalizeTemperature({ main: 0 })).toBeNull()
    expect(normalizeTemperature({ main: -40 })).toBeNull()
    expect(normalizeTemperature({ main: 400 })).toBeNull()
    expect(normalizeTemperature({ main: 61.5 })).toBe(61.5)
  })
})
