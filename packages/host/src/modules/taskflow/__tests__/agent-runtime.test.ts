import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureAgentRuntimeArtifacts } from '../adapters/agent-runtime.ts'
import { ensureWorktreeStorageDirs } from '../adapters/fs.ts'

async function writeControlEnv(agentCtlPath: string, controlUrl: string): Promise<void> {
  await nodeTest.write(
    join(agentCtlPath, '..', 'control.env'),
    [
      `PORTTA_FLOW_CONTROL_URL='${controlUrl}'`,
      "PORTTA_FLOW_CONTROL_TOKEN='test-token'",
      "PORTTA_FLOW_WORKTREE_ID='worktree-1'",
      "PORTTA_FLOW_BRANCH='feature/test'",
      '',
    ].join('\n'),
  )
}

describe('ensureAgentRuntimeArtifacts', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('writes agent control helpers and agent hook settings into worktree-owned paths', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)

    await ensureWorktreeStorageDirs(gitDir)
    const artifacts = await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    })

    expect(await nodeTest.file(artifacts.agentCtlPath).text()).toContain('portta-agentctl')
    expect(await nodeTest.file(artifacts.agentCtlPath).text()).toContain('claude-user-prompt-submit')
    expect(await nodeTest.file(artifacts.agentCtlPath).text()).toContain('codex-user-prompt-submit')
    expect(await nodeTest.file(artifacts.agentCtlPath).text()).toContain('agent_status_changed')

    const settings = (await nodeTest.file(artifacts.claudeSettingsPath).json()) as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>
        Notification?: Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>
        Stop?: Array<{ hooks?: Array<{ command?: string }> }>
        PostToolUse?: Array<{ hooks?: Array<{ command?: string }> }>
      }
    }

    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain('portta-agentctl')
    expect(settings.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain('claude-user-prompt-submit')
    expect(settings.hooks?.Notification?.[0]?.matcher).toBe('permission_prompt|elicitation_dialog')
    expect(settings.hooks?.Notification?.[0]?.hooks?.[0]?.command).toContain('status-changed --lifecycle idle')
    expect(settings.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('agent-stopped')
    expect(settings.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain('status-changed --lifecycle running')
    expect(settings.hooks?.PostToolUse?.[1]?.hooks?.[0]?.command).toContain('claude-post-tool-use')

    const codexHooks = (await nodeTest.file(artifacts.codexHooksPath).json()) as {
      hooks?: {
        SessionStart?: Array<{ matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }>
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>
        PermissionRequest?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>
        PreToolUse?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>
        Stop?: Array<{ hooks?: Array<{ command?: string; timeout?: number }> }>
        PostToolUse?: Array<{ matcher?: string; hooks?: Array<{ command?: string; timeout?: number }> }>
      }
    }

    expect(codexHooks.hooks?.SessionStart?.[0]?.matcher).toBe('startup|resume|clear')
    expect(codexHooks.hooks?.SessionStart?.[0]?.hooks?.[0]?.command).toContain('codex-session-start')
    expect(codexHooks.hooks?.UserPromptSubmit?.[0]?.hooks?.[0]?.command).toContain('codex-user-prompt-submit')
    expect(codexHooks.hooks?.PermissionRequest?.[0]?.hooks?.[0]?.command).toContain('codex-permission-request')
    expect(codexHooks.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toContain('status-changed --lifecycle running')
    expect(codexHooks.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command).toContain('--best-effort')
    expect(codexHooks.hooks?.Stop?.[0]?.hooks?.[0]?.command).toContain('codex-stop')
    expect(codexHooks.hooks?.PostToolUse).toHaveLength(1)
    expect(codexHooks.hooks?.PostToolUse?.[0]?.matcher).toBe('Bash')
    expect(codexHooks.hooks?.PostToolUse?.[0]?.hooks?.[0]?.command).toContain('codex-post-tool-use')
    expect(codexHooks.hooks?.PostToolUse?.[0]?.hooks?.[0]?.timeout).toBe(30)
    const excludes = await nodeTest.file(join(gitDir, 'info', 'exclude')).text()
    expect(excludes).toContain('.claude/settings.local.json')
    expect(excludes).toContain('.codex/hooks.json')
  })

  it('preserves non-taskflow Codex hooks when refreshing generated hooks', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)

    await ensureWorktreeStorageDirs(gitDir)
    const staleGeneratedCommand = `${join(gitDir, 'portta', 'portta-agentctl')} codex-user-prompt-submit`
    await mkdir(join(worktreePath, '.codex'), { recursive: true })
    await nodeTest.write(
      join(worktreePath, '.codex', 'hooks.json'),
      `${JSON.stringify(
        {
          hooks: {
            UserPromptSubmit: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'echo keep-me',
                  },
                ],
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: "sh -lc 'echo portta-agentctl wrapper'",
                  },
                ],
              },
              {
                hooks: [
                  {
                    type: 'command',
                    command: staleGeneratedCommand,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      )}\n`,
    )

    const artifacts = await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    })
    await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    })

    const codexHooks = (await nodeTest.file(artifacts.codexHooksPath).json()) as {
      hooks?: {
        UserPromptSubmit?: Array<{ hooks?: Array<{ command?: string }> }>
      }
    }
    const commands =
      codexHooks.hooks?.UserPromptSubmit?.flatMap((group) => group.hooks?.map((hook) => hook.command ?? '') ?? []) ?? []

    expect(commands.filter((command) => command.includes('keep-me'))).toHaveLength(1)
    expect(commands.filter((command) => command.includes('portta-agentctl wrapper'))).toHaveLength(1)
    expect(commands.filter((command) => command.includes('codex-user-prompt-submit'))).toHaveLength(1)
    expect(commands.some((command) => command === staleGeneratedCommand)).toBe(false)
  })

  it('lets Codex stop continue naturally when the control endpoint is unreachable', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)

    await ensureWorktreeStorageDirs(gitDir)
    const artifacts = await ensureAgentRuntimeArtifacts({
      gitDir,
      worktreePath,
    })
    await writeControlEnv(artifacts.agentCtlPath, 'http://127.0.0.1:1/runtime-events')

    const process = nodeTest.spawn([artifacts.agentCtlPath, 'codex-stop'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    expect(exitCode).toBe(0)
    expect(JSON.parse(stdout)).toEqual({})
  })

  it('does not report auto-reviewed Codex permission requests as human idle', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)
    let capturedPayload: unknown

    const server = nodeTest.serve({
      port: 0,
      async fetch(request) {
        capturedPayload = await request.json()
        return Response.json({ ok: true })
      },
    })

    try {
      await ensureWorktreeStorageDirs(gitDir)
      const artifacts = await ensureAgentRuntimeArtifacts({ gitDir, worktreePath })
      await writeControlEnv(artifacts.agentCtlPath, `http://127.0.0.1:${server.port}/runtime-events`)

      const process = nodeTest.spawn([artifacts.agentCtlPath, 'codex-permission-request'], {
        env: { ...globalThis.process.env, PORTTA_FLOW_AGENT_PERMISSION_MODE: 'auto-review' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(exitCode).toBe(0)
      expect(capturedPayload).toBeUndefined()
    } finally {
      server.stop(true)
    }
  })

  it('reports interactive Codex permission requests as human idle', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)
    let capturedPayload: unknown

    const server = nodeTest.serve({
      port: 0,
      async fetch(request) {
        capturedPayload = await request.json()
        return Response.json({ ok: true })
      },
    })

    try {
      await ensureWorktreeStorageDirs(gitDir)
      const artifacts = await ensureAgentRuntimeArtifacts({ gitDir, worktreePath })
      await writeControlEnv(artifacts.agentCtlPath, `http://127.0.0.1:${server.port}/runtime-events`)

      const process = nodeTest.spawn([artifacts.agentCtlPath, 'codex-permission-request'], {
        env: { ...globalThis.process.env, PORTTA_FLOW_AGENT_PERMISSION_MODE: 'interactive' },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(exitCode).toBe(0)
      expect(capturedPayload).toEqual({
        type: 'agent_status_changed',
        lifecycle: 'idle',
        worktreeId: 'worktree-1',
        branch: 'feature/test',
      })
    } finally {
      server.stop(true)
    }
  })

  it('reports Codex notify turn completion without trusted project hooks', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-codex-home-'))
    tempDirs.push(gitDir, worktreePath, codexHome)
    let capturedPayload: unknown

    const server = nodeTest.serve({
      port: 0,
      async fetch(request) {
        capturedPayload = await request.json()
        return Response.json({ ok: true })
      },
    })

    try {
      await ensureWorktreeStorageDirs(gitDir)
      const artifacts = await ensureAgentRuntimeArtifacts({ gitDir, worktreePath })
      await writeControlEnv(artifacts.agentCtlPath, `http://127.0.0.1:${server.port}/runtime-events`)
      const sessionsDir = join(codexHome, 'sessions', '2026', '09', '10')
      await mkdir(sessionsDir, { recursive: true })
      await nodeTest.write(
        join(sessionsDir, 'rollout-2026-09-10T00-00-00-thread-1.jsonl'),
        `${JSON.stringify({
          type: 'session_meta',
          payload: { id: 'thread-1', source: 'cli', thread_source: 'user' },
        })}\n`,
      )

      const process = nodeTest.spawn(
        [
          artifacts.agentCtlPath,
          'codex-notify',
          JSON.stringify({
            type: 'agent-turn-complete',
            'thread-id': 'thread-1',
            'turn-id': 'turn-1',
          }),
        ],
        { env: { ...globalThis.process.env, CODEX_HOME: codexHome }, stdout: 'pipe', stderr: 'pipe' },
      )
      const [exitCode] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(exitCode).toBe(0)
      expect(capturedPayload).toEqual({
        type: 'agent_stopped',
        worktreeId: 'worktree-1',
        branch: 'feature/test',
      })
    } finally {
      server.stop(true)
    }
  })

  it('ignores Codex completion notifications from auto-review and hidden auxiliary threads', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    const codexHome = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-codex-home-'))
    tempDirs.push(gitDir, worktreePath, codexHome)
    const capturedPayloads: unknown[] = []

    const server = nodeTest.serve({
      port: 0,
      async fetch(request) {
        capturedPayloads.push(await request.json())
        return Response.json({ ok: true })
      },
    })

    try {
      await ensureWorktreeStorageDirs(gitDir)
      const artifacts = await ensureAgentRuntimeArtifacts({ gitDir, worktreePath })
      await writeControlEnv(artifacts.agentCtlPath, `http://127.0.0.1:${server.port}/runtime-events`)
      const sessionsDir = join(codexHome, 'sessions', '2026', '09', '10')
      await mkdir(sessionsDir, { recursive: true })
      await nodeTest.write(
        join(sessionsDir, 'rollout-2026-09-10T00-00-00-guardian-thread.jsonl'),
        `${JSON.stringify({
          type: 'session_meta',
          payload: {
            id: 'guardian-thread',
            source: { subagent: { other: 'guardian' } },
            thread_source: 'guardian_review',
          },
        })}\n`,
      )

      for (const threadId of ['guardian-thread', 'untracked-title-thread']) {
        const process = nodeTest.spawn(
          [
            artifacts.agentCtlPath,
            'codex-notify',
            JSON.stringify({ type: 'agent-turn-complete', 'thread-id': threadId }),
          ],
          { env: { ...globalThis.process.env, CODEX_HOME: codexHome }, stdout: 'pipe', stderr: 'pipe' },
        )
        const [exitCode] = await Promise.all([
          process.exited,
          new Response(process.stdout).text(),
          new Response(process.stderr).text(),
        ])
        expect(exitCode).toBe(0)
      }

      expect(capturedPayloads).toEqual([])
    } finally {
      server.stop(true)
    }
  })

  it('detects Codex Bash PR creation payloads', async () => {
    const gitDir = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-gitdir-'))
    const worktreePath = await mkdtemp(join(tmpdir(), 'taskflow-agent-runtime-worktree-'))
    tempDirs.push(gitDir, worktreePath)
    let capturedPayload: unknown

    const server = nodeTest.serve({
      port: 0,
      async fetch(request) {
        capturedPayload = await request.json()
        return Response.json({ ok: true })
      },
    })

    try {
      await ensureWorktreeStorageDirs(gitDir)
      const artifacts = await ensureAgentRuntimeArtifacts({
        gitDir,
        worktreePath,
      })
      await writeControlEnv(artifacts.agentCtlPath, `http://127.0.0.1:${server.port}/runtime-events`)

      const process = nodeTest.spawn([artifacts.agentCtlPath, 'codex-post-tool-use'], {
        stdin: 'pipe',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      process.stdin!.write(
        JSON.stringify({
          tool_name: 'Bash',
          tool_input: {
            command: 'gh pr create --fill',
          },
          tool_response: {
            stdout: 'Created pull request: https://github.com/windmill-labs/taskflow/pull/123',
          },
        }),
      )
      process.stdin!.end()

      const [exitCode] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])

      expect(exitCode).toBe(0)
      expect(capturedPayload).toEqual({
        type: 'pr_opened',
        worktreeId: 'worktree-1',
        branch: 'feature/test',
        url: 'https://github.com/windmill-labs/taskflow/pull/123',
      })
    } finally {
      server.stop(true)
    }
  })
})
