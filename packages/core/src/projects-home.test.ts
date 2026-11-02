import { describe, expect, it } from 'vitest'
import {
  classifyProjectLocation,
  defaultProjectsHome,
  isDescendantPath,
  normalizeProjectsHome,
  ProjectsHomeError,
  parseRelativeProjectPath,
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

  it('accepts a path of any depth under the Home', () => {
    expect(parseRelativeProjectPath('brasil-data-hub/base-empresarial')).toBe('brasil-data-hub/base-empresarial')
    expect(resolveProjectPath('/srv/projects', 'grupo/app')).toBe('/srv/projects/grupo/app')
  })

  it('refuses absolute paths, hidden segments and traversal', () => {
    expect(() => parseRelativeProjectPath('/srv/projects/funat')).toThrow(ProjectsHomeError)
    expect(() => parseRelativeProjectPath('brasil-data-hub/.base')).toThrow(ProjectsHomeError)
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
