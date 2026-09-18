import { describe, expect, it } from 'vitest'
import {
  composeFilesFromLabel,
  parseRunnerRequest,
  projectOperable,
  runnerCreateArguments,
  runnerRefusal,
  runnerSpec,
} from './runner.ts'

describe('parseRunnerRequest', () => {
  it('accepts every verb in the closed set', () => {
    for (const verb of ['up', 'stop', 'restart', 'build', 'down', 'down-volumes']) {
      expect(parseRunnerRequest({ verb, project: 'alpha' }).verb).toBe(verb)
    }
  })

  it('rejects anything outside the set', () => {
    expect(() => parseRunnerRequest({ verb: 'exec', project: 'alpha' })).toThrow('unknown runner verb')
    expect(() => parseRunnerRequest({ verb: 'down --volumes', project: 'alpha' })).toThrow('unknown runner verb')
    expect(() => parseRunnerRequest({ verb: 'rm -rf', project: 'alpha' })).toThrow('unknown runner verb')
  })

  it('rejects a missing or illegal project name', () => {
    expect(() => parseRunnerRequest({ verb: 'up' })).toThrow('project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: '' })).toThrow('project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: '../etc' })).toThrow('refusing project name')
    expect(() => parseRunnerRequest({ verb: 'up', project: 'alpha; rm -rf /' })).toThrow('refusing project name')
  })

  it('accepts no-cache only on build', () => {
    expect(parseRunnerRequest({ verb: 'build', project: 'alpha', flags: ['no-cache'] }).flags).toEqual(['no-cache'])
    expect(() => parseRunnerRequest({ verb: 'up', project: 'alpha', flags: ['no-cache'] })).toThrow('no-cache')
    expect(() => parseRunnerRequest({ verb: 'build', project: 'alpha', flags: ['privileged'] })).toThrow(
      'unknown runner flag',
    )
  })

  it('carries the working directory and the compose files only on up', () => {
    const parsed = parseRunnerRequest({
      verb: 'up',
      project: 'gamma',
      workingDir: '/srv/dev/gamma',
      configFiles: ['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'],
    })
    expect(parsed.workingDir).toBe('/srv/dev/gamma')
    expect(parsed.configFiles).toEqual(['/srv/dev/gamma/compose.yaml', '/srv/shared/base.yaml'])
    expect(
      parseRunnerRequest({ verb: 'up', project: 'gamma', workingDir: '/srv/dev/gamma' }).configFiles,
    ).toBeUndefined()
    expect(() => parseRunnerRequest({ verb: 'build', project: 'gamma', workingDir: '/srv/dev/gamma' })).toThrow(
      'only valid with up',
    )
    expect(() =>
      parseRunnerRequest({ verb: 'down-volumes', project: 'gamma', configFiles: ['/srv/dev/gamma/compose.yaml'] }),
    ).toThrow('only valid with up')
    expect(() =>
      parseRunnerRequest({ verb: 'up', project: 'gamma', configFiles: ['/srv/dev/gamma/compose.yaml'] }),
    ).toThrow('need a workingDir')
  })

  it('bounds every path the way remove_working_dir does, and refuses what the shell parser cannot carry', () => {
    const up = (workingDir: unknown, configFiles?: unknown) => () =>
      parseRunnerRequest({ verb: 'up', project: 'gamma', workingDir, configFiles })
    expect(up('srv/dev/gamma')).toThrow('not absolute')
    expect(up('/srv/dev/../gamma')).toThrow('walks up')
    expect(up('/')).toThrow("refusing working directory '/'")
    expect(up('/srv')).toThrow('top-level')
    expect(up('/srv/')).toThrow('top-level')
    expect(up(' /srv/dev/gamma')).toThrow('padded')
    expect(up('/srv/dev/ga,mma')).toThrow('cannot be carried')
    expect(up('/srv/dev/ga"mma')).toThrow('cannot be carried')
    expect(up('/srv/dev/ga\\mma')).toThrow('cannot be carried')
    expect(up('/srv/dev/ga\nmma')).toThrow('control character')
    expect(up(42)).toThrow('need a workingDir')
    expect(up('/srv/dev/gamma', '/srv/dev/gamma/compose.yaml')).toThrow('must be an array')
    expect(up('/srv/dev/gamma', [42])).toThrow('must be a string')
    expect(up('/srv/dev/gamma', ['compose.yaml'])).toThrow('not absolute')
    expect(up('/srv/dev/gamma', ['/compose.yaml'])).toThrow('top-level')
    expect(up('/srv/dev/gamma', ['/srv/dev/gamma/../x/compose.yaml'])).toThrow('walks up')
  })

  it('accepts directory only on down-volumes', () => {
    expect(parseRunnerRequest({ verb: 'down-volumes', project: 'alpha', flags: ['directory'] }).flags).toEqual([
      'directory',
    ])
    expect(() => parseRunnerRequest({ verb: 'down', project: 'alpha', flags: ['directory'] })).toThrow('directory')
    expect(() => parseRunnerRequest({ verb: 'build', project: 'alpha', flags: ['directory'] })).toThrow('directory')
  })
})

describe('projectOperable', () => {
  it('a project with no working-dir label is not operable', () => {
    const result = projectOperable(null)
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('working directory')
  })

  it('a project with a working-dir label is operable', () => {
    const result = projectOperable('/srv/dev/alpha', ['/srv/dev/alpha/compose.yaml'])
    expect(result.ok).toBe(true)
    expect(result.reason).toBeNull()
    expect(result.configFiles).toEqual(['/srv/dev/alpha/compose.yaml'])
  })
})

describe('composeFilesFromLabel', () => {
  it('splits the Compose comma-separated list', () => {
    expect(composeFilesFromLabel('/a/compose.yaml,/a/compose.portta.yaml')).toEqual([
      '/a/compose.yaml',
      '/a/compose.portta.yaml',
    ])
  })
})

describe('runnerRefusal', () => {
  it('refuses a publicly exposed panel', () => {
    expect(runnerRefusal({ PORTTA_WEB_EXPOSE: 'public' })).toContain('on the host instead')
  })

  it('refuses the remote-public profile', () => {
    expect(runnerRefusal({ PORTTA_PROFILE: 'remote-public' })).toContain('on the host only')
  })
})

describe('the container it would create', () => {
  const args = runnerCreateArguments('/opt/portta', runnerSpec('/opt/portta', '0.7.2'), '0.7.2')

  it('takes no network, so it cannot be a pivot', () => {
    expect(args).toContain('--network')
    expect(args[args.indexOf('--network') + 1]).toBe('none')
  })

  it('fixes its command at creation', () => {
    expect(args.slice(-2)).toEqual(['bash', '/opt/portta/scripts/lib/runner-exec.sh'])
  })

  it('mounts the host filesystem at /host, and the root at its host path', () => {
    expect(args).toContain('/:/host')
    expect(args).toContain('/opt/portta:/opt/portta')
  })
})
