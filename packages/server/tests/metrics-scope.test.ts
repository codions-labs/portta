import type { MetricsCurrent, MetricsHistory } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { historyFor, metricsFor } from '../src/services/metrics.ts'

const project = (composeProject: string, own?: true) =>
  ({ id: composeProject, name: composeProject, composeProject, own, containers: [], containerCount: 1 }) as never

const metrics = {
  host: { hostname: 'vps' },
  projects: [project('mine'), project('theirs'), project('portta', true)],
  dockerStorage: {
    collectedAt: 1,
    projects: [
      { composeProject: 'mine', volumeBytes: 1, layerBytes: 0 },
      { composeProject: 'theirs', volumeBytes: 9, layerBytes: 0 },
      { composeProject: 'stopped-theirs', volumeBytes: 5, layerBytes: 0 },
    ],
  },
} as unknown as MetricsCurrent

describe('what a person who sees some projects reads of the metrics', () => {
  it('keeps the host, their projects and Portta, and drops what belongs to others', () => {
    const scoped = metricsFor(metrics, (name) => name === 'mine')
    expect(scoped.host).toEqual(metrics.host)
    expect(scoped.projects.map((entry) => entry.composeProject)).toEqual(['mine', 'portta'])
    expect(scoped.dockerStorage?.projects.map((entry) => entry.composeProject)).toEqual(['mine'])
  })
  it('leaves a missing disk reading missing', () => {
    expect(metricsFor({ ...metrics, dockerStorage: null }, () => false).dockerStorage).toBeNull()
  })
})

describe('what a person who sees some projects reads of the history', () => {
  const history = {
    windowSeconds: 900,
    points: [
      {
        timestamp: 1,
        host: { cpuUtilisation: 0.5 },
        projects: [
          { id: 'mine', cpuUtilisation: 1, memoryUsedBytes: 1 },
          { id: 'theirs', cpuUtilisation: 2, memoryUsedBytes: 9 },
        ],
        containers: [{ id: 'abc', cpuUtilisation: 2, memoryUsedBytes: 9 }],
      },
    ],
  } as unknown as MetricsHistory

  it('keeps the host and their projects, and no container of anybody', () => {
    const [point] = historyFor(history, (id) => id === 'mine').points
    expect(point?.host).toEqual({ cpuUtilisation: 0.5 })
    expect(point?.projects.map((entry) => entry.id)).toEqual(['mine'])
    expect(point?.containers).toEqual([])
  })
})
