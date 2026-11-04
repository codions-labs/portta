// The panel reads the server itself when nothing on the host is writing. What
// matters is that it reads the *host* (never a VM it happens to live in), that
// what it reports is what `htop` would, and that a stopped collector no longer
// leaves hours-old numbers on the page.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  containerFromStats,
  cpuBetween,
  createLiveMetrics,
  distroOf,
  LiveMetrics,
  parseCpuTimes,
  parseLoadavg,
  parseMeminfo,
  parseUptime,
  readsTheHost,
  storageFromDisk,
} from '../src/services/live-metrics.ts'
import { readCurrentMetrics } from '../src/services/metrics.ts'
import { testConfig } from './helpers.ts'

const GB = 1024 ** 3

const MEMINFO = `MemTotal:       16384000 kB
MemFree:          409600 kB
MemAvailable:    12288000 kB
Buffers:          102400 kB
Cached:         11000000 kB
SwapTotal:       2097152 kB
SwapFree:        2097152 kB
`

describe('what /proc says', () => {
  it('counts what a program could still get, not what is empty', () => {
    const memory = parseMeminfo(MEMINFO)
    // 16 GB with the cache full is not a full machine: htop calls this a quarter used.
    expect(memory?.totalBytes).toBe(16384000 * 1024)
    expect((memory?.totalBytes ?? 0) - (memory?.availableBytes ?? 0)).toBe(4096000 * 1024)
    expect(memory?.swapUsedBytes).toBe(0)
  })

  it('takes the processor busy between two readings, never the average since boot', () => {
    const before = parseCpuTimes('cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 1 1 1 1')
    const after = parseCpuTimes('cpu  200 0 200 1000 0 0 0 0 0 0')
    // 200 busy ticks of 400: half. Since boot it would have read 20%.
    expect(cpuBetween(before!, after!)).toBeCloseTo(0.5)
    expect(cpuBetween(after!, after!)).toBeNull()
  })

  it('reads load and uptime as the kernel prints them', () => {
    expect(parseLoadavg('0.17 0.14 0.11 2/44 1234')).toEqual({ one: 0.17, five: 0.14, fifteen: 0.11 })
    expect(parseUptime('1265.35 9000.00')).toBe(1265)
    expect(parseLoadavg('garbage')).toBeNull()
  })

  it('splits the distribution from its version', () => {
    expect(distroOf('Debian GNU/Linux 13 (trixie)')).toEqual({ distro: 'Debian GNU/Linux', version: '13' })
    expect(distroOf('Ubuntu 24.04.1 LTS')).toEqual({ distro: 'Ubuntu', version: '24.04.1' })
  })
})

describe('whether /proc is the host’s', () => {
  const info = (extra: object) =>
    ({ Name: 'srv', OSType: 'linux', OperatingSystem: 'Debian GNU/Linux 13', ...extra }) as never
  it('is, on an Engine running on Linux', () => {
    expect(readsTheHost(info({}), 'linux')).toBe(true)
  })
  it('is not, behind Docker Desktop or OrbStack, where it would be a VM called the machine', () => {
    expect(readsTheHost(info({ OperatingSystem: 'Docker Desktop' }), 'linux')).toBe(false)
    expect(readsTheHost(info({ OperatingSystem: 'OrbStack' }), 'linux')).toBe(false)
    expect(readsTheHost(info({ Name: 'docker-desktop' }), 'linux')).toBe(false)
  })
  it('is not on a panel that is not on Linux, or that cannot reach Docker', () => {
    expect(readsTheHost(info({}), 'darwin')).toBe(false)
    expect(readsTheHost(null, 'linux')).toBe(false)
  })
})

describe('the containers', () => {
  const identity = { id: 'abc', name: 'shop-web-1', service: 'web' }

  it('reads cores, so a container on four of them is not shown on one', () => {
    const stats = {
      cpu_stats: { cpu_usage: { total_usage: 4_000_000 }, system_cpu_usage: 8_000_000, online_cpus: 8 },
      precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
      memory_stats: { usage: 3 * GB, limit: 8 * GB, stats: { inactive_file: 1 * GB } },
    }
    const metrics = containerFromStats(stats, identity)
    expect(metrics.cpuUtilisation).toBeCloseTo(4)
    // The file cache the kernel gives back is not what the container holds.
    expect(metrics.memoryUsedBytes).toBe(2 * GB)
  })

  it('sums the networks and says nothing when there is no CPU to compare with', () => {
    const metrics = containerFromStats(
      { networks: { eth0: { rx_bytes: 10, tx_bytes: 5 }, eth1: { rx_bytes: 1, tx_bytes: 1 } } } as never,
      identity,
    )
    expect([metrics.networkRxBytes, metrics.networkTxBytes]).toEqual([11, 6])
    expect(metrics.cpuUtilisation).toBeNull()
  })

  it('credits volumes and writable layers to their Compose project', () => {
    const storage = storageFromDisk(
      {
        Volumes: [
          {
            Name: 'a',
            Driver: 'local',
            Labels: { 'com.docker.compose.project': 'shop' },
            UsageData: { Size: 100, RefCount: 1 },
          },
          { Name: 'b', Driver: 'local', UsageData: { Size: 999, RefCount: 0 } },
        ],
        Containers: [
          { Id: 'c', ImageID: 'i', State: 'running', Labels: { 'com.docker.compose.project': 'shop' }, SizeRw: 40 },
        ],
      },
      1,
    )
    expect(storage.projects).toEqual([{ composeProject: 'shop', volumeBytes: 100, layerBytes: 40 }])
  })
})

// A fake machine: /proc as text that the test moves forward, Docker as plain objects.
function machine(overrides: { info?: object } = {}) {
  let stat = 'cpu  100 0 100 800 0 0 0 0 0 0'
  const procs: Record<string, string> = {
    meminfo: MEMINFO,
    loadavg: '0.17 0.14 0.11 2/44 1',
    uptime: '1265.35 9000.00',
    cpuinfo: 'model name\t: Test CPU @ 3GHz\n',
  }
  const docker = {
    async info() {
      return {
        Name: 'g13-develop',
        OSType: 'linux',
        OperatingSystem: 'Debian GNU/Linux 13 (trixie)',
        KernelVersion: '6.12.0',
        Architecture: 'x86_64',
        NCPU: 8,
        MemTotal: 16384000 * 1024,
        ...overrides.info,
      }
    },
    async listContainers() {
      return [{ Id: 'abc', Names: ['/shop-web-1'], Labels: { 'com.docker.compose.project': 'shop' } }]
    },
    async stats() {
      return {
        cpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 8_000_000, online_cpus: 8 },
        precpu_stats: { cpu_usage: { total_usage: 0 }, system_cpu_usage: 0 },
        memory_stats: { usage: 2 * GB, limit: 8 * GB, stats: {} },
      }
    },
    async diskUsage() {
      return { Volumes: [], Containers: [] }
    },
  }
  let clock = 1_800_000_000_000
  const live = new LiveMetrics(docker as never, testConfig({ projectName: 'portta' }), {
    proc: (name) => (name === 'stat' ? stat : (procs[name] ?? null)),
    storage: () => ({
      path: '/',
      mount: '/',
      filesystem: null,
      totalBytes: 269 * GB,
      usedBytes: 225 * GB,
      availableBytes: 31 * GB,
      usedPercent: 0.88,
    }),
    platform: 'linux',
    now: () => clock,
  })
  return {
    live,
    advance(ms: number, nextStat?: string) {
      clock += ms
      if (nextStat) stat = nextStat
    },
    clock: () => clock,
  }
}

describe('the sampler', () => {
  it('reports the machine as htop would, with the CPU of the last seconds', async () => {
    const { live, advance } = machine()
    await live.tick()
    advance(3_000, 'cpu  110 0 110 880 0 0 0 0 0 0')
    await live.tick()
    const snapshot = live.snapshot()
    expect(snapshot?.host).toMatchObject({
      hostname: 'g13-develop',
      distro: 'Debian GNU/Linux',
      version: '13',
      architecture: 'x64',
      uptimeSeconds: 1265,
      memoryUsedPercent: 0.25,
      load: { one: 0.17 },
    })
    // 20 busy ticks of 100.
    expect(snapshot?.host.cpuUtilisation).toBeCloseTo(0.2)
    expect(snapshot?.projects[0]).toMatchObject({ composeProject: 'shop', memoryUsedBytes: 2 * GB })
    expect(snapshot?.projects[0]?.cpuUtilisation).toBeCloseTo(2)
  })

  it('says nothing where the panel would be reading a VM', async () => {
    const { live } = machine({ info: { OperatingSystem: 'Docker Desktop' } })
    await live.tick()
    expect(live.snapshot()).toBeNull()
  })
})

describe('what the panel serves', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
    createLiveMetrics({} as never, testConfig())
  })

  function config(file: object | null, ageSeconds: number) {
    const dir = mkdtempSync(join(tmpdir(), 'portta-live-'))
    dirs.push(dir)
    if (file) {
      writeFileSync(
        join(dir, 'current.json'),
        JSON.stringify({ ...file, collectedAt: Math.floor(Date.now() / 1000) - ageSeconds }),
      )
    }
    return testConfig({ metricsDir: dir })
  }

  const collected = {
    version: 1,
    instance: { id: 'i', name: null, hostname: 'srv' },
    runtime: { name: 'docker-engine' },
    projects: [],
    host: {
      hostname: 'srv',
      timezone: 'Europe/Berlin',
      model: 'QEMU',
      kind: 'vm',
      virtual: true,
      uptimeSeconds: 86_400,
      memoryUsedPercent: 0.98,
      cpu: { manufacturer: 'Intel', brand: 'Xeon', physicalCores: 4, logicalCores: 8, speed: 2, speedMax: 3 },
      gpu: [],
      load: { one: 90.9, five: 24.19, fifteen: 9.08 },
    },
  }

  async function started() {
    const { live, advance } = machine()
    createLiveMetrics({} as never, testConfig())
    await live.tick()
    advance(3_000, 'cpu  110 0 110 880 0 0 0 0 0 0')
    await live.tick()
    return live
  }

  it('prefers the collector while it is writing', () => {
    const current = readCurrentMetrics(config(collected, 2))
    expect(current).toMatchObject({ stale: false, collectorActive: true })
    expect(current.host?.load?.one).toBe(90.9)
  })

  it('serves the old file, marked old, where the panel cannot read the machine', () => {
    const current = readCurrentMetrics(config(collected, 7200))
    expect(current).toMatchObject({ stale: true, collectorActive: false })
  })

  it('takes over from a stopped collector, keeping only what the host alone knows', async () => {
    const live = await started()
    // `liveMetrics()` is the registered one; register this one the way boot does.
    const registered = createLiveMetrics({} as never, testConfig())
    Object.assign(registered, { latest: live.snapshot() })
    const current = readCurrentMetrics(config(collected, 7200))
    expect(current).toMatchObject({ stale: false, collectorActive: true })
    // The numbers are now, not the file's 98 % and its load of 90.
    expect(current.host?.uptimeSeconds).toBe(1265)
    expect(current.host?.load?.one).toBe(0.17)
    expect(current.host?.memoryUsedPercent).toBe(0.25)
    // The time zone is the host's, which the panel's container does not know.
    expect(current.host?.timezone).toBe('Europe/Berlin')
    expect(current.host?.model).toBe('QEMU')
  })

  it('does not call a reading live that the sampler stopped refreshing', async () => {
    const live = await started()
    const registered = createLiveMetrics({} as never, testConfig())
    // Its newest reading is the machine's clock of 2027-01-15; the panel's is a day later.
    Object.assign(registered, { latest: live.snapshot() })
    const later = (live.snapshot()?.collectedAt ?? 0) * 1000 + 24 * 3600 * 1000
    const current = readCurrentMetrics(config(collected, 7200), later)
    expect(current).toMatchObject({ stale: true, collectorActive: false })
  })

  it('serves the panel’s reading when no file was ever written', async () => {
    const live = await started()
    const registered = createLiveMetrics({} as never, testConfig())
    Object.assign(registered, { latest: live.snapshot() })
    const current = readCurrentMetrics(config(null, 0))
    expect(current).toMatchObject({ stale: false, collectorActive: true })
    expect(current.host?.hostname).toBe('g13-develop')
  })
})
