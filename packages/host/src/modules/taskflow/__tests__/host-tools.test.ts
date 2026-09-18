import { delimiter, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hostToolInvocation, resolveHostTool, wellKnownBinDirectories, wellKnownToolPaths } from '../lib/host-tools.ts'

function accept(paths: readonly string[]): (candidate: string) => boolean {
  const allowed = new Set(paths)
  return (candidate: string): boolean => allowed.has(candidate)
}

describe('wellKnownBinDirectories', () => {
  it('includes user, package-manager, and platform directories', () => {
    const directories = wellKnownBinDirectories({
      env: { HOME: '/home/me' },
      execPath: '/home/me/.fnm/aliases/default/bin/node',
      npmGlobalBin: '/home/me/.npm-global/bin',
      platform: 'linux',
    })

    expect(directories).toContain('/home/me/.local/bin')
    expect(directories).toContain('/home/me/.cargo/bin')
    expect(directories).toContain('/home/me/.bun/bin')
    expect(directories).toContain('/home/me/.volta/bin')
    expect(directories).toContain('/home/me/.asdf/shims')
    expect(directories).toContain('/home/me/.local/share/mise/shims')
    expect(directories).toContain('/home/me/.fnm/aliases/default/bin')
    expect(directories).toContain('/home/me/.npm-global/bin')
    expect(directories).toContain('/opt/homebrew/bin')
    expect(directories).toContain('/usr/local/bin')
    expect(directories).toContain('/home/linuxbrew/.linuxbrew/bin')
  })
})

describe('resolveHostTool', () => {
  it('finds a binary on PATH', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin:/opt/bin', HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/opt/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/opt/bin/codex')
  })

  it('uses the login-shell command -v result when PATH misses the tool', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/home/me/.nvm/versions/node/v24.0.0/bin/codex']),
        lookupLoginShellCommand: (tool: string): string | null =>
          tool === 'codex' ? '/home/me/.nvm/versions/node/v24.0.0/bin/codex' : null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/home/me/.nvm/versions/node/v24.0.0/bin/codex')
  })

  it('finds Codex in a well-known user directory outside PATH', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/home/me/.local/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/home/me/.local/bin/codex')
  })

  it('finds Claude in the installer-specific extra path', () => {
    expect(wellKnownToolPaths('claude', { HOME: '/Users/me' })).toEqual(['/Users/me/.claude/local/claude'])
    expect(
      resolveHostTool('claude', {
        env: { PATH: '/usr/bin', HOME: '/Users/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/Users/me/.claude/local/claude']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'darwin',
      }),
    ).toBe('/Users/me/.claude/local/claude')
  })

  it('rejects a PATH entry that is not an executable file', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/tmp/not-a-file:/usr/bin', HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: () => false,
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBeNull()
  })

  it('honors CODEX_BIN when the override is executable', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me', CODEX_BIN: '/opt/custom/codex' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/opt/custom/codex', '/usr/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/opt/custom/codex')
  })

  it('does not fall back when CODEX_BIN is set but not executable', () => {
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me', CODEX_BIN: '/missing/codex' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/usr/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBeNull()
  })

  it('accepts an absolute path that is executable', () => {
    expect(
      resolveHostTool('/opt/bin/codex', {
        env: { PATH: '/usr/bin' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/opt/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/opt/bin/codex')
  })

  it('uses the Node sibling directory for globally installed CLIs', () => {
    const execPath = '/home/me/.fnm/aliases/default/bin/node'
    expect(
      resolveHostTool('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me' },
        execPath,
        isExecutable: accept([join(dirname(execPath), 'codex')]),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe(join(dirname(execPath), 'codex'))
  })

  it('quotes invocations only when the resolved path needs a shell escape', () => {
    expect(
      hostToolInvocation('codex', {
        env: { PATH: '/usr/bin', HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/usr/bin/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe('/usr/bin/codex')
    expect(
      hostToolInvocation('codex', {
        env: { PATH: `/tmp/with space${delimiter}/usr/bin`, HOME: '/home/me' },
        execPath: '/usr/bin/node',
        isExecutable: accept(['/tmp/with space/codex']),
        lookupLoginShellCommand: () => null,
        npmGlobalBin: null,
        platform: 'linux',
      }),
    ).toBe("'/tmp/with space/codex'")
  })
})
