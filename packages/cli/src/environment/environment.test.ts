import { describe, expect, it, vi } from 'vitest'
import { agentsProbe } from './agents.ts'
import { developmentProbe } from './development.ts'
import { dockerProbe } from './docker.ts'
import { sshProbe, tmuxProbe } from './ssh.ts'
import type { ProbeContext } from './types.ts'

function result(stdout = '', failed = false, stderr = '') {
  return { stdout, stderr, failed, exitCode: failed ? 1 : 0 }
}

function context(
  options: {
    paths?: Record<string, string | null>
    responses?: Record<string, ReturnType<typeof result>>
    environment?: NodeJS.ProcessEnv
  } = {},
): ProbeContext {
  return {
    locate: vi.fn(async (tool) => options.paths?.[tool] ?? null),
    run: vi.fn(async (file, args = []) => {
      const key = `${file} ${args.join(' ')}`
      if (file === 'which')
        return options.paths?.[String(args[0])] ? result(String(options.paths[String(args[0])])) : result('', true)
      return options.responses?.[key] ?? result('', true)
    }),
    fileMode: vi.fn(() => null),
    homeDir: '/path-that-does-not-exist/portta-test',
    environment: options.environment ?? {},
  }
}

describe('environment probes', () => {
  it('parses installed versions and reports gh authentication separately', async () => {
    const probe = context({
      paths: { node: '/bin/node', npm: '/bin/npm', npx: '/bin/npx', git: '/bin/git', gh: '/bin/gh', tailscale: null },
      responses: {
        '/bin/node --version': result('v24.0.0\n'),
        '/bin/npm --version': result('10.9.0\n'),
        '/bin/npx --version': result('10.9.0\n'),
        '/bin/git --version': result('git version 2.48.0\n'),
        '/bin/git config --global user.name': result('Ada\n'),
        '/bin/git config --global user.email': result('ada@example.test\n'),
        '/bin/gh --version': result('gh version 2.70.0\n'),
        '/bin/gh auth status': result('', true, 'not logged in'),
      },
    })
    const checks = await developmentProbe.probe(probe)
    expect(checks.find((entry) => entry.id === 'tools.node')).toMatchObject({
      status: 'pass',
      tool: { version: 'v24.0.0' },
    })
    expect(checks.find((entry) => entry.id === 'tools.gh')).toMatchObject({ status: 'warn', fix: 'gh auth login' })
    expect(checks.find((entry) => entry.id === 'tools.tailscale')?.status).toBe('info')
  })

  it('does not call an absent optional agent and marks it neutral', async () => {
    const probe = context()
    const checks = await agentsProbe.probe(probe)
    expect(checks).toHaveLength(5)
    expect(checks.every((entry) => entry.status === 'info')).toBe(true)
    expect(probe.run).not.toHaveBeenCalled()
  })

  it('makes a non-zero or timed-out version probe a usability warning', async () => {
    const probe = context({
      paths: { tmux: '/bin/tmux' },
      responses: { '/bin/tmux -V': result('', true, 'timed out') },
    })
    const [check] = await tmuxProbe.probe(probe)
    expect(check).toMatchObject({ status: 'warn', tool: { installed: true, version: null } })
    expect(check?.detail).toMatch(/failed or timed out/)
  })

  it('distinguishes Docker socket permission denial from an unreachable daemon', async () => {
    const probe = context({
      paths: { docker: '/bin/docker' },
      responses: {
        '/bin/docker version --format {{.Client.Version}}': result('27.3.1\n'),
        '/bin/docker version --format {{.Server.Version}}': result('27.3.1\n'),
        '/bin/docker info': result('', true, 'permission denied while trying to connect'),
        '/bin/docker compose version --short': result('2.29.7\n'),
      },
    })
    const [check] = await dockerProbe.probe(probe)
    expect(check?.status).toBe('fail')
    expect(check?.details).toContainEqual({ status: 'fail', text: 'daemon reachable, but this user cannot access it' })
  })

  it('treats missing SSH setup as not applicable without creating it', async () => {
    const probe = context({
      paths: { ssh: '/usr/bin/ssh' },
      responses: { '/usr/bin/ssh -V': result('', false, 'OpenSSH_9.9') },
    })
    const [check] = await sshProbe.probe(probe)
    expect(check?.status).toBe('pass')
    expect(check?.details).toContainEqual({ status: 'info', text: '~/.ssh has not been created' })
  })
})
