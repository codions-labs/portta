import { describe, expect, it } from 'vitest'
import {
  classifyProjectLocation,
  defaultProjectsHome,
  firstLevelCandidateName,
  isDescendantPath,
  normalizeProjectsHome,
  ProjectsHomeError,
  parseRelativeProjectPath,
  relativePathFromWorkingDir,
  relativeRepositoryPath,
  resolveProjectPath,
} from './projects-home.ts'

describe('defaultProjectsHome', () => {
  it('uses ~/projects for a user install and /srv/projects for root', () => {
    expect(defaultProjectsHome('/home/fabio', false)).toBe('/home/fabio/projects')
    expect(defaultProjectsHome('/Users/fabio', false)).toBe('/Users/fabio/projects')
    expect(defaultProjectsHome('/root', true)).toBe('/srv/projects')
    expect(defaultProjectsHome('/', false)).toBe('/srv/projects')
  })
})

describe('normalizeProjectsHome', () => {
  it('expands a tilde and makes a relative path absolute', () => {
    expect(normalizeProjectsHome('~/work', '/', '/home/fabio')).toBe('/home/fabio/work')
    expect(normalizeProjectsHome('projects', '/home/fabio', '/home/fabio')).toBe('/home/fabio/projects')
    expect(normalizeProjectsHome('/srv/projects')).toBe('/srv/projects')
  })

  it('refuses the root, a walk-up and a NUL', () => {
    expect(() => normalizeProjectsHome('/')).toThrow(ProjectsHomeError)
    expect(() => normalizeProjectsHome('/srv/projects/../..')).toThrow(ProjectsHomeError)
    expect(() => normalizeProjectsHome('/srv/pro\0jects')).toThrow(ProjectsHomeError)
    expect(() => normalizeProjectsHome('')).toThrow(ProjectsHomeError)
  })
})

describe('parseRelativeProjectPath and resolveProjectPath', () => {
  it('accepts a single first-level name', () => {
    expect(parseRelativeProjectPath('brasil-data-hub')).toBe('brasil-data-hub')
    expect(parseRelativeProjectPath(' funat ')).toBe('funat')
    expect(resolveProjectPath('/srv/projects', 'funat')).toBe('/srv/projects/funat')
  })

  it('refuses absolute paths, nested paths and traversal', () => {
    expect(() => parseRelativeProjectPath('/srv/projects/funat')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('brasil-data-hub/base-empresarial')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('../etc')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('funat/..')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('.')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('.hidden')).toThrow(ProjectsHomeError)
  })
})

describe('classifyProjectLocation', () => {
  it('treats a first-level child as managed', () => {
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/srv/projects/funat',
      }),
    ).toBe('managed')
  })

  it('classifies a symlink that realpath-ed outside the Home as escaped', () => {
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/srv/projects/escape',
        homeRealpath: '/srv/projects',
        pathRealpath: '/etc/passwd',
      }),
    ).toBe('escaped')
  })

  it('does not treat an escaped symlink as managed', () => {
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/srv/projects/escape',
        homeRealpath: '/srv/projects',
        pathRealpath: '/home/fabio/elsewhere',
      }),
    ).not.toBe('managed')
  })

  it('marks a path outside the Home as external', () => {
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/Users/fabio/Projects/demo-shop',
      }),
    ).toBe('external')
  })

  it('distinguishes missing and inaccessible from a measured empty directory', () => {
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/srv/projects/gone',
        pathRealpath: null,
      }),
    ).toBe('missing')
    expect(
      classifyProjectLocation({
        home: '/srv/projects',
        path: '/srv/projects/locked',
        readable: false,
      }),
    ).toBe('inaccessible')
  })
})

describe('relativePathFromWorkingDir', () => {
  it('backfills only an unambiguous first-level child', () => {
    expect(relativePathFromWorkingDir('/srv/projects', '/srv/projects/funat')).toBe('funat')
    expect(relativePathFromWorkingDir('/srv/projects', '/srv/projects/brasil-data-hub/base-empresarial')).toBe(
      'brasil-data-hub',
    )
  })

  it('refuses anything it cannot prove', () => {
    expect(relativePathFromWorkingDir('/srv/projects', '/Users/fabio/demo-shop')).toBeNull()
    expect(relativePathFromWorkingDir('/srv/projects', '/srv/projects')).toBeNull()
    expect(relativePathFromWorkingDir('/srv/projects', '/srv/projects/.hidden')).toBeNull()
    expect(isDescendantPath('/srv/projects', '/srv/projects/funat/apps')).toBe(true)
    expect(isDescendantPath('/srv/projects', '/srv/projectx')).toBe(false)
  })
})

describe('firstLevelCandidateName', () => {
  it('drops hidden and well-known junk', () => {
    expect(firstLevelCandidateName('funat')).toBe(true)
    expect(firstLevelCandidateName('.git')).toBe(false)
    expect(firstLevelCandidateName('node_modules')).toBe(false)
    expect(firstLevelCandidateName('lost+found')).toBe(false)
    expect(firstLevelCandidateName('')).toBe(false)
  })
})

describe('relativeRepositoryPath', () => {
  it('keeps one or two segments under the Home', () => {
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects/funat')).toBe('funat')
    expect(relativeRepositoryPath('/srv/projects/', '/srv/projects/brasil-data-hub/base-empresarial')).toBe(
      'brasil-data-hub/base-empresarial',
    )
  })

  it('answers null outside the Home, at the Home, deeper than two levels, and across hidden names', () => {
    expect(relativeRepositoryPath('/srv/projects', '/Users/fabio/demo-shop')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projectx/funat')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects/a/b/c')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects/.hidden')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects/ws/.hidden')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', '/srv/projects/node_modules/x')).toBeNull()
    expect(relativeRepositoryPath('/', '/srv/projects')).toBeNull()
    expect(relativeRepositoryPath('/srv/projects', 'relative/path')).toBeNull()
  })
})
