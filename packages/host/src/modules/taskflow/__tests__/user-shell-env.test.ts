import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHostShellPathRefresher,
  createUserShellPathResolver,
  resolveUserShellPath,
  type SpawnUserShellEnv,
  type UserShellEnvSpawnResult,
} from '../lib/user-shell-env.ts'

function shellOutput(path: string): string {
  return [
    'shell startup output',
    '__PORTTA_FLOW_SHELL_ENV_START__',
    `PATH=${path}`,
    '__PORTTA_FLOW_SHELL_ENV_END__',
  ].join('\n')
}

function result(stdout: string, status = 0): UserShellEnvSpawnResult {
  return { signal: null, status, stderr: '', stdout }
}

function spawnResults(results: UserShellEnvSpawnResult[]): {
  calls: Parameters<SpawnUserShellEnv>[0][]
  spawn: SpawnUserShellEnv
} {
  const calls: Parameters<SpawnUserShellEnv>[0][] = []
  return {
    calls,
    spawn: async (args): Promise<UserShellEnvSpawnResult> => {
      calls.push(args)
      const next = results.shift()
      if (!next) throw new Error('Unexpected shell environment probe')
      return next
    },
  }
}

describe('resolveUserShellPath', () => {
  it('settles when a shell ignores SIGTERM', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'taskflow-shell-timeout-'))
    const shell = join(directory, 'ignore-term.js')
    await writeFile(
      shell,
      ['#!/usr/bin/env node', 'process.on("SIGTERM", () => {});', 'setInterval(() => {}, 1_000);'].join('\n'),
    )
    await chmod(shell, 0o755)
    const startedAt = Date.now()

    try {
      await expect(
        resolveUserShellPath({
          env: { PATH: `${dirname(process.execPath)}${delimiter}/usr/bin`, SHELL: shell },
          platform: 'linux',
          timeoutMs: 25,
        }),
      ).resolves.toBeNull()
      expect(Date.now() - startedAt).toBeLessThan(1_000)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('uses the configured interactive login shell', async () => {
    const probe = spawnResults([result(shellOutput('/Users/me/.local/bin:/usr/bin'))])

    await expect(
      resolveUserShellPath({
        env: { PATH: '/usr/bin', SHELL: '/bin/zsh' },
        platform: 'darwin',
        spawnUserShellEnv: probe.spawn,
      }),
    ).resolves.toBe('/Users/me/.local/bin:/usr/bin')

    expect(probe.calls[0]?.command).toBe('/bin/zsh')
    expect(probe.calls[0]?.args[0]).toBe('-ilc')
  })

  it('falls back to a non-interactive login shell', async () => {
    const probe = spawnResults([result('', 1), result(shellOutput('/home/me/.local/bin:/usr/bin'))])

    await expect(
      resolveUserShellPath({
        env: { PATH: '/usr/bin', SHELL: '/bin/bash' },
        platform: 'linux',
        spawnUserShellEnv: probe.spawn,
      }),
    ).resolves.toBe('/home/me/.local/bin:/usr/bin')

    expect(probe.calls.map((call) => call.args[0])).toEqual(['-ilc', '-lc'])
  })

  it('keeps the last successful PATH after a failed refresh', async () => {
    const probe = spawnResults([result(shellOutput('/home/me/bin:/usr/bin')), result('', 1)])
    const resolvePath = createUserShellPathResolver({
      env: { PATH: '/usr/bin', SHELL: '/bin/bash' },
      platform: 'linux',
      spawnUserShellEnv: probe.spawn,
    })

    await expect(resolvePath()).resolves.toBe('/home/me/bin:/usr/bin')
    await expect(resolvePath()).resolves.toBe('/home/me/bin:/usr/bin')
  })

  it('uses plain login mode for sh-compatible shells', async () => {
    const probe = spawnResults([result(shellOutput('/usr/bin:/bin'))])

    await expect(
      resolveUserShellPath({ env: { PATH: '/usr/bin' }, platform: 'linux', spawnUserShellEnv: probe.spawn }),
    ).resolves.toBe('/usr/bin:/bin')

    expect(probe.calls[0]?.command).toBe('/bin/sh')
    expect(probe.calls[0]?.args[0]).toBe('-lc')
  })

  it('uses fish login and non-login command flags', async () => {
    const probe = spawnResults([result('', 1), result(shellOutput('/home/me/.local/bin:/usr/bin'))])

    await expect(
      resolveUserShellPath({
        env: { PATH: '/usr/bin', SHELL: '/usr/bin/fish' },
        platform: 'linux',
        spawnUserShellEnv: probe.spawn,
      }),
    ).resolves.toBe('/home/me/.local/bin:/usr/bin')

    expect(probe.calls.map((call) => call.args[0])).toEqual(['-lc', '-c'])
  })
})

describe('createHostShellPathRefresher', () => {
  it('shares a probe within its TTL and updates the target environment', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', SHELL: '/bin/bash' }
    const probe = spawnResults([result(shellOutput('/home/me/bin:/usr/bin')), result(shellOutput('/opt/bin:/usr/bin'))])
    let now = 0
    const refresher = createHostShellPathRefresher({
      env,
      now: (): number => now,
      platform: 'linux',
      refreshTtlMs: 100,
      spawnUserShellEnv: probe.spawn,
    })

    await expect(Promise.all([refresher.refresh(), refresher.refresh()])).resolves.toEqual([
      { changed: true, path: '/usr/bin:/home/me/bin' },
      { changed: true, path: '/usr/bin:/home/me/bin' },
    ])
    expect(probe.calls).toHaveLength(1)
    expect(env.PATH).toBe('/usr/bin:/home/me/bin')

    now = 99
    await expect(refresher.refresh()).resolves.toEqual({ changed: false, path: '/usr/bin:/home/me/bin' })
    expect(probe.calls).toHaveLength(1)

    now = 100
    await expect(refresher.refresh()).resolves.toEqual({ changed: true, path: '/usr/bin:/home/me/bin:/opt/bin' })
    expect(probe.calls).toHaveLength(2)
  })

  it('keeps an executable directory inherited from the invoking terminal', async () => {
    const env: NodeJS.ProcessEnv = { PATH: '/agent/bin:/usr/bin', SHELL: '/bin/zsh' }
    const probe = spawnResults([result(shellOutput('/Users/me/.local/bin:/usr/bin'))])
    const refresher = createHostShellPathRefresher({
      env,
      platform: 'darwin',
      spawnUserShellEnv: probe.spawn,
    })

    await expect(refresher.refresh()).resolves.toEqual({
      changed: true,
      path: '/agent/bin:/usr/bin:/Users/me/.local/bin',
    })
    expect(env.PATH).toBe('/agent/bin:/usr/bin:/Users/me/.local/bin')
  })
})
