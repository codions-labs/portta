import type { ProjectSummary } from 'portta-contracts'
import { describe, expect, it } from 'vitest'
import { affectedBy, availableActions } from '@/components/entities/project-actions'
import {
  DEFAULT_PROJECT_FILTERS,
  defaultProjectOrder,
  folderOfProject,
  groupByFolder,
  groupProjects,
  hasFolders,
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
    pinned: false,
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

  it('finds the projects whose code is not committed or not pushed in any environment', () => {
    const state = { ...DEFAULT_PROJECT_FILTERS, state: 'unpushed' as const }
    expect(matchesProjectFilters(item, state, new Set(['produto-pr-12']))).toBe(true)
    expect(matchesProjectFilters(item, state, new Set(['another']))).toBe(false)
    expect(matchesProjectFilters(item, state)).toBe(false)
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

describe('environments nobody adopted', () => {
  const env = (name: string, workingDir: string | null, mounts: string[] = []) =>
    ({ name, workingDir, services: [{ mounts: mounts.map((source) => ({ source })) }] }) as never

  it('puts the ones that run from the same folder together, in the order they were found', () => {
    const groups = groupByFolder([
      env('billing', '/srv/billing'),
      env('tuttoria-a', '/root/projects/tuttoria'),
      env('tuttoria-e2e', '/root/projects/tuttoria'),
      env('hand-made', null),
      env('tuttoria-b', '/root/projects/tuttoria'),
    ])
    expect(groups.map((group) => [group.folder, group.environments.map((entry) => entry.name)])).toEqual([
      [null, ['billing']],
      ['/root/projects/tuttoria', ['tuttoria-a', 'tuttoria-e2e', 'tuttoria-b']],
      [null, ['hand-made']],
    ])
  })

  it('does not make a group of one, or of what names no folder', () => {
    const groups = groupByFolder([env('a', '/srv/a'), env('b', null), env('c', null)])
    expect(groups.every((group) => group.folder === null)).toBe(true)
    expect(groups).toHaveLength(3)
  })

  it('brings in one started by hand when every file it mounts is from that folder', () => {
    const groups = groupByFolder([
      env('tuttoria-a', '/root/projects/tuttoria'),
      env('tuttoria-e2e', '/root/projects/tuttoria'),
      env('validation', null, ['/root/projects/tuttoria/docker/mysql/init.sql', '/var/lib/docker/volumes/x/_data']),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.environments.map((entry) => entry.name)).toEqual(['tuttoria-a', 'tuttoria-e2e', 'validation'])
  })

  it('guesses nothing when the mounts reach outside the folder or could belong to two', () => {
    const groups = groupByFolder([
      env('a', '/srv/app'),
      env('b', '/srv/app'),
      env('outside', null, ['/srv/app/x', '/etc/hosts']),
      env('nested-a', '/srv/app/sub'),
      env('ambiguous', null, ['/srv/app/sub/file']),
    ])
    expect(groups.find((group) => group.environments.some((entry) => entry.name === 'outside'))?.folder).toBeNull()
    expect(groups.find((group) => group.environments.some((entry) => entry.name === 'ambiguous'))?.folder).toBeNull()
  })
})

describe('grouping by folder', () => {
  const at = (slug: string, relativePath: string | null) =>
    toListItems([summary({ slug, name: slug, relativePath })], undefined)[0]!
  const labels = { state: (state: string) => state, without: (key: string) => key, noFolder: 'No folder' }

  it('reads the client from the first folder under Projects Home', () => {
    expect(folderOfProject(at('a', 'powertech/lms-platform'))).toBe('powertech')
    expect(folderOfProject(at('b', 'portainerengenharia/portainerengenharia/app'))).toBe('portainerengenharia')
    expect(folderOfProject(at('c', 'loja'))).toBeNull()
    expect(folderOfProject(at('d', null))).toBeNull()
  })

  it('offers folders only when a project sits below the top', () => {
    expect(hasFolders([at('c', 'loja'), at('d', null)])).toBe(false)
    expect(hasFolders([at('c', 'loja'), at('a', 'powertech/lms-platform')])).toBe(true)
  })

  it('makes one band per folder by name and leaves the projects with none last', () => {
    const items = [
      at('lms-mobile', 'powertech/lms-mobile'),
      at('loja', 'loja'),
      at('publivor', 'sudofabio/publivor'),
      at('lms-platform', 'powertech/lms-platform'),
    ]
    const bands = groupProjects(items, 'folder', labels)
    expect(bands.map((band) => [band.title, band.items.map((item) => item.slug)])).toEqual([
      ['powertech', ['lms-mobile', 'lms-platform']],
      ['sudofabio', ['publivor']],
      ['No folder', ['loja']],
    ])
  })
})

describe('pinned projects', () => {
  const labels = { state: (state: string) => state, without: (key: string) => key, pinned: 'Pinned', others: 'Others' }
  const item = (slug: string, pinned: boolean) => toListItems([summary({ slug, name: slug, pinned })], undefined)[0]!

  it('puts a pinned project before one that is worse off, then keeps the usual order', () => {
    const ordered = [item('b', false), item('a', true), item('c', false)].sort(defaultProjectOrder)
    expect(ordered.map((project) => project.slug)).toEqual(['a', 'b', 'c'])
  })

  it('makes a Pinned band at the top of an ungrouped list, and none when nothing or everything is pinned', () => {
    const bands = groupProjects([item('a', true), item('b', false)], 'none', labels)
    expect(bands.map((band) => [band.title, band.items.map((project) => project.slug)])).toEqual([
      ['Pinned', ['a']],
      ['Others', ['b']],
    ])
    expect(groupProjects([item('b', false)], 'none', labels)).toHaveLength(1)
    expect(groupProjects([item('a', true)], 'none', labels)[0]?.title).toBeNull()
  })
})
