import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  generateServiceFile,
  parseEnvCliArgs,
  readEnvVarsFromUnit,
  redactUnit,
  resolveEnvVars,
  type ServiceConfig,
  serviceCommands,
  serviceFilePath,
} from './host-service.js'

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'portta-host-service-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const linux: ServiceConfig = {
  platform: 'linux',
  porttaPath: '/usr/local/bin/portta',
  root: '/home/dev/.portta',
  envVars: {},
}

describe('the host service unit', () => {
  it('runs `portta host serve` from the installation, under one machine-wide name', () => {
    const unit = generateServiceFile(linux)
    expect(unit).toContain('ExecStart=/usr/local/bin/portta host serve')
    expect(unit).toContain('WorkingDirectory=/home/dev/.portta')
    expect(unit).toContain('Environment=PORTTA_ROOT=/home/dev/.portta')
    expect(serviceFilePath('linux', '/home/dev')).toBe('/home/dev/.config/systemd/user/portta-host.service')

    const plist = generateServiceFile({ ...linux, platform: 'darwin' })
    expect(plist).toContain('<string>com.portta.host</string>')
    expect(plist).toMatch(
      /<string>\/usr\/local\/bin\/portta<\/string>\s*<string>host<\/string>\s*<string>serve<\/string>/,
    )
    expect(serviceFilePath('darwin', '/Users/dev')).toBe('/Users/dev/Library/LaunchAgents/com.portta.host.plist')
  })

  it('reads back the variables a person added, and not the ones it writes itself', async () => {
    await withTempDir(async (dir) => {
      const envVars = { LINEAR_API_KEY: 'lin_xyz', FOO: 'bar=baz', ESCAPED: 'needs <escaping> & a&mp' }
      for (const platform of ['linux', 'darwin'] as const) {
        const file = join(dir, `unit-${platform}`)
        await writeFile(file, generateServiceFile({ ...linux, platform, envVars }))
        expect(readEnvVarsFromUnit(file, platform)).toEqual(envVars)
      }
      expect(readEnvVarsFromUnit(join(dir, 'missing'), 'linux')).toEqual({})
    })
  })

  it('masks secret-looking values in the plan it shows', () => {
    const envVars = { LINEAR_API_KEY: 'lin_secret_value', PLAIN: 'visible' }
    const shown = redactUnit(generateServiceFile({ ...linux, envVars }), envVars)
    expect(shown).not.toContain('lin_secret_value')
    expect(shown).toContain('visible')
  })
})

describe('the unit environment', () => {
  it('keeps the installed values, then the shell, then --env', () => {
    const { envVars } = resolveEnvVars({
      cliEnv: { LINEAR_API_KEY: 'cli' },
      processEnv: { LINEAR_API_KEY: 'shell' },
      existing: { LINEAR_API_KEY: 'old', OTHER: 'kept' },
      autoPickup: true,
    })
    expect(envVars).toEqual({ LINEAR_API_KEY: 'cli', OTHER: 'kept' })
    expect(
      resolveEnvVars({ cliEnv: {}, processEnv: { LINEAR_API_KEY: 'shell' }, existing: {}, autoPickup: false }).envVars,
    ).toEqual({})
    expect(
      resolveEnvVars({ cliEnv: {}, processEnv: { LINEAR_API_KEY: '' }, existing: {}, autoPickup: true }).envVars,
    ).toEqual({})
  })

  it('refuses malformed and reserved --env values without dropping the good ones', () => {
    expect(parseEnvCliArgs(['JWT=a.b=c', 'no_equals', '1BAD=x', 'PATH=/tmp', 'PORTTA_ROOT=/x'])).toEqual({
      envVars: { JWT: 'a.b=c' },
      errors: [
        expect.stringContaining('KEY=VALUE'),
        expect.stringContaining('1BAD'),
        expect.stringContaining('PATH'),
        expect.stringContaining('PORTTA_ROOT'),
      ],
    })
  })
})

describe('the service manager commands', () => {
  it('drives the systemd user unit', () => {
    expect(serviceCommands('install', 'linux')).toEqual([
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', '--now', 'portta-host']],
    ])
    expect(serviceCommands('restart', 'linux')).toEqual([['systemctl', ['--user', 'restart', 'portta-host']]])
  })

  it('drives the launchd agent', () => {
    expect(serviceCommands('install', 'darwin', '/p.plist')).toEqual([['launchctl', ['load', '-w', '/p.plist']]])
    const [restart] = serviceCommands('restart', 'darwin')
    expect(restart?.[1][2]).toMatch(/^gui\/\d+\/com\.portta\.host$/)
  })
})
