import type { MetricsCurrent } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { metricsFor } from '../src/services/metrics.ts'

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
