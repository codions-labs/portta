import type { HostMetrics, ProjectResourceMetrics } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { projectsOfUsed, usageSplit } from '@/lib/server-usage'

const GB = 1024 ** 3

const host = {
  memoryTotalBytes: 32 * GB,
  memoryUsedBytes: 12 * GB,
  cpuUtilisation: 0.2,
  cpu: { logicalCores: 4 },
  storage: { totalBytes: 512 * GB, usedBytes: 208 * GB },
} as unknown as HostMetrics

const project = (
  composeProject: string,
  memory: number | null,
  cpu: number | null,
  own = false,
): ProjectResourceMetrics =>
  ({
    id: composeProject,
    name: composeProject,
    composeProject,
    own: own || undefined,
    memoryUsedBytes: memory,
    cpuUtilisation: cpu,
    containerCount: 1,
    containers: [],
  }) as unknown as ProjectResourceMetrics

describe('what the server is used for', () => {
  it('splits memory into projects, Portta and the rest', () => {
    const split = usageSplit('memory', host, [
      project('shop', 3 * GB, 0.1),
      project('blog', 1 * GB, 0.05),
      project('portta', 0.5 * GB, 0.01, true),
    ])!
    expect(split.total).toBe(32 * GB)
    expect(split.used).toBe(12 * GB)
    expect(split.free).toBe(20 * GB)
    expect(split.projects).toBe(4 * GB)
    expect(split.portta).toBe(0.5 * GB)
    expect(split.system).toBe(7.5 * GB)
    expect(split.shares.map((share) => share.environment)).toEqual(['shop', 'blog'])
    expect(split.shares[0]!.share).toBeCloseTo(3 / 32)
    expect(projectsOfUsed(split)).toBeCloseTo(4 / 12)
  })

  it('counts the processor in cores of the whole server', () => {
    const split = usageSplit('cpu', host, [project('shop', 1, 0.5), project('portta', 1, 0.1, true)])!
    expect(split.total).toBe(4)
    expect(split.used).toBeCloseTo(0.8)
    expect(split.projects).toBeCloseTo(0.5)
    expect(split.portta).toBeCloseTo(0.1)
    expect(split.system).toBeCloseTo(0.2)
  })

  it('never lets the projects add up to more than the server says is in use', () => {
    const split = usageSplit('memory', host, [project('shop', 20 * GB, null)])!
    expect(split.projects).toBe(12 * GB)
    expect(split.system).toBe(0)
    expect(split.free).toBe(20 * GB)
  })

  it('splits the disk by what each project keeps on it, once that is reported', () => {
    const storage = {
      collectedAt: 1,
      projects: [
        { composeProject: 'shop', volumeBytes: 30 * GB, layerBytes: 2 * GB },
        { composeProject: 'blog', volumeBytes: 5 * GB, layerBytes: 1 * GB },
        { composeProject: 'portta', volumeBytes: 4 * GB, layerBytes: 0 },
        { composeProject: 'stopped', volumeBytes: 10 * GB, layerBytes: 0 },
      ],
    }
    const split = usageSplit(
      'disk',
      host,
      [project('shop', 1, 1), project('blog', 1, 1), project('portta', 1, 1, true)],
      storage,
    )!
    expect(split.projects).toBe(48 * GB)
    expect(split.portta).toBe(4 * GB)
    expect(split.system).toBe(156 * GB)
    expect(split.free).toBe(304 * GB)
    // A project that is stopped still keeps its volumes.
    expect(split.shares.map((share) => share.environment)).toEqual(['shop', 'stopped', 'blog'])
    expect(projectsOfUsed(split)).toBeCloseTo(48 / 208)
  })

  it('splits the GPU memory by what each project holds, and says nothing without it', () => {
    const withGpu = { ...host, gpuMemory: { usedBytes: 10 * GB, totalBytes: 24 * GB } } as unknown as HostMetrics
    const held = (name: string, bytes: number, own = false) => ({ ...project(name, 1, 1, own), gpuMemoryBytes: bytes })
    const split = usageSplit('gpu', withGpu, [held('shop', 6 * GB), held('portta', 1 * GB, true)])!
    expect(split.total).toBe(24 * GB)
    expect(split.projects).toBe(6 * GB)
    expect(split.portta).toBe(1 * GB)
    expect(split.system).toBe(3 * GB)
    expect(usageSplit('gpu', host, [])).toBeNull()
  })

  it('does not split the disk before the collector reports it', () => {
    const split = usageSplit('disk', host, [project('shop', 1, 1)])!
    expect(split.used).toBe(208 * GB)
    expect(split.free).toBe(304 * GB)
    expect(split.projects).toBeNull()
    expect(projectsOfUsed(split)).toBeNull()
  })

  it('says nothing when the server does not report a total', () => {
    expect(usageSplit('memory', { ...host, memoryTotalBytes: null } as HostMetrics, [])).toBeNull()
    expect(usageSplit('disk', { ...host, storage: null } as HostMetrics, [])).toBeNull()
  })
})
