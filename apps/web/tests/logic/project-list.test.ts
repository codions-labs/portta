import type { ProjectSummary } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { affectedBy, availableActions } from '@/components/entities/project-actions'
import {
  DEFAULT_PROJECT_FILTERS,
  defaultProjectOrder,
  groupProjects,
  matchesProjectFilters,
  parseTag,
  projectState,
  tagCounts,
  tagKeys,
  toListItem,
  toListItems,
} from '@/lib/projects'
import { makePulse } from '../ui/fixtures.ts'

function summary(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'p1',
    slug: 'produto',
    name: 'Meu Produto',
    description: null,
    archived: false,
    relativePath: null,
    location: 'external',
    tags: [],
    environmentCount: 2,
    runningEnvironmentCount: 1,
    environments: [
      { name: 'produto', running: true, serviceCount: 4, runningCount: 4, unhealthyCount: 0 },
      { name: 'produto-pr-12', running: false, serviceCount: 3, runningCount: 0, unhealthyCount: 0 },
    ],
    ...overrides,
  }
}

describe('the project list model', () => {
  it('has no health verdict of its own when the dashboard is unavailable', () => {
    const item = toListItem(summary(), undefined)
    expect(item.health).toBeNull()
  })

  it('merges the dashboard pulse onto the catalog entry', () => {
    const [item] = toListItems([summary()], [makePulse()])
    expect(item?.health).toBe('ok')
    expect(item?.environments).toHaveLength(2)
  })
})

describe('projectState', () => {
  it('prefers the dashboard verdict when there is one', () => {
    const item = toListItem(summary(), makePulse({ health: 'unhealthy' }))
    expect(projectState(item)).toBe('unhealthy')
  })

  it('works out a state from the environments alone', () => {
    expect(projectState(toListItem(summary(), undefined))).toBe('running')
    expect(
      projectState(
        toListItem(
          summary({
            runningEnvironmentCount: 0,
            environments: [{ name: 'produto', running: false, serviceCount: 4, runningCount: 0, unhealthyCount: 0 }],
          }),
          undefined,
        ),
      ),
    ).toBe('idle')
    expect(
      projectState(
        toListItem(
          summary({
            environments: [{ name: 'produto', running: true, serviceCount: 4, runningCount: 2, unhealthyCount: 0 }],
          }),
          undefined,
        ),
      ),
    ).toBe('partial')
  })

  it('says archived before anything else', () => {
    expect(projectState(toListItem(summary({ archived: true }), makePulse({ health: 'unhealthy' })))).toBe('archived')
  })
})

describe('filters', () => {
  const item = toListItem(summary(), makePulse())

  it('hides archived projects unless they are asked for', () => {
    const archived = toListItem(summary({ archived: true }), undefined)
    expect(matchesProjectFilters(archived, DEFAULT_PROJECT_FILTERS)).toBe(false)
    expect(matchesProjectFilters(archived, { ...DEFAULT_PROJECT_FILTERS, includeArchived: true })).toBe(true)
    expect(matchesProjectFilters(archived, { ...DEFAULT_PROJECT_FILTERS, state: 'archived' })).toBe(true)
  })

  it('searches the name, the slug and the environment names', () => {
    expect(matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, search: 'produt' })).toBe(true)
    expect(matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, search: 'pr-12' })).toBe(true)
    expect(matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, search: 'nothing' })).toBe(false)
  })

  it('narrows by state', () => {
    expect(matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, state: 'running' })).toBe(true)
    expect(matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, state: 'idle' })).toBe(false)
  })
})

describe('the default order', () => {
  it('puts what is wrong above what is fine', () => {
    const broken = toListItem(summary({ slug: 'a', name: 'A' }), makePulse({ slug: 'a', health: 'unhealthy' }))
    const fine = toListItem(summary({ slug: 'b', name: 'B' }), makePulse({ slug: 'b', health: 'ok' }))
    expect([fine, broken].sort(defaultProjectOrder)[0]?.slug).toBe('a')
  })
})

describe('what a project can be asked to do', () => {
  const item = toListItem(summary(), undefined)
  const target = { slug: item.slug, name: item.name, archived: item.archived, environments: item.environments }

  it('offers only the actions that would change something', () => {
    expect(availableActions(target)).toEqual(['start', 'stop', 'restart'])

    const idle = {
      ...target,
      environments: [{ name: 'x', running: false, serviceCount: 2, runningCount: 0, unhealthyCount: 0 }],
    }
    expect(availableActions(idle)).toEqual(['start'])

    const busy = {
      ...target,
      environments: [{ name: 'x', running: true, serviceCount: 2, runningCount: 2, unhealthyCount: 0 }],
    }
    expect(availableActions(busy)).toEqual(['stop', 'restart'])

    expect(availableActions({ ...target, environments: [] })).toEqual([])
  })

  it('counts what a stop would interrupt, and what a start would bring up', () => {
    expect(affectedBy(target, 'stop')).toEqual({ environments: ['produto'], containers: 4 })
    expect(affectedBy(target, 'start')).toEqual({ environments: ['produto-pr-12'], containers: 3 })
  })
})

describe('tags on the project list', () => {
  const acme = { key: 'cliente', value: 'Acme' }
  const globex = { key: 'cliente', value: 'Globex' }
  const a = toListItem(summary({ slug: 'a', name: 'A', tags: [acme, { key: '', value: 'loja' }] }), undefined)
  const b = toListItem(summary({ slug: 'b', name: 'B', tags: [globex] }), undefined)
  const c = toListItem(summary({ slug: 'c', name: 'C', tags: [] }), undefined)

  it('reads what somebody typed as a key and a value, at the first colon only', () => {
    expect(parseTag('Cliente: Acme')).toEqual(acme)
    expect(parseTag('loja')).toEqual({ key: '', value: 'loja' })
    expect(parseTag('url: http://x')).toEqual({ key: 'url', value: 'http://x' })
    expect(parseTag('  ')).toBeNull()
    expect(parseTag('cliente:')).toBeNull()
  })

  it('filters by one tag, and finds a project by its tag in the search', () => {
    expect(
      [a, b, c].filter((item) => matchesProjectFilters(item, { ...DEFAULT_PROJECT_FILTERS, tag: 'cliente: Acme' })),
    ).toEqual([a])
    expect(matchesProjectFilters(b, { ...DEFAULT_PROJECT_FILTERS, search: 'globex' })).toBe(true)
    expect(matchesProjectFilters(c, { ...DEFAULT_PROJECT_FILTERS, search: 'globex' })).toBe(false)
  })

  it('counts the tags in use, most used first, and offers their keys to group by', () => {
    expect(tagCounts([a, b, c]).map((entry) => entry.label)).toEqual(['cliente: Acme', 'cliente: Globex', 'loja'])
    expect(tagKeys([a, b, c])).toEqual(['cliente'])
  })

  it('groups by a key, with the projects that have none last, and by state', () => {
    const labels = { state: (state: string) => state, without: (key: string) => `Sem ${key}` }
    expect(
      groupProjects([a, b, c], 'tag:cliente', labels).map((band) => [band.title, band.items.map((i) => i.slug)]),
    ).toEqual([
      ['Acme', ['a']],
      ['Globex', ['b']],
      ['Sem cliente', ['c']],
    ])
    expect(groupProjects([a, b, c], 'none', labels)).toHaveLength(1)
    expect(groupProjects([a], 'state', labels)[0]?.title).toBe('running')
  })

  it('puts a project with two values under each of them', () => {
    const both = toListItem(summary({ slug: 'd', tags: [acme, globex] }), undefined)
    const bands = groupProjects([both], 'tag:cliente', { state: String, without: String })
    expect(bands.map((band) => band.title)).toEqual(['Acme', 'Globex'])
  })
})
