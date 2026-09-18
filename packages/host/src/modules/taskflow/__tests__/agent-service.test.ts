import { describe, expect, it } from 'vitest'
import type { AgentDefinition } from '../services/agent-registry.ts'
import {
  buildAgentPaneCommand,
  buildDockerAgentPaneCommand,
  buildDockerRuntimePaneCommand,
  buildDockerShellCommand,
  buildManagedRuntimePaneCommand,
  buildManagedShellCommand,
} from '../services/agent-service.ts'

function builtInAgent(id: 'claude' | 'codex'): AgentDefinition {
  return {
    id,
    label: id === 'claude' ? 'Claude' : 'Codex',
    kind: 'builtin',
    capabilities: {
      terminal: true,
      inAppChat: true,
      conversationHistory: true,
      interrupt: true,
      resume: true,
    },
    implementation: {
      type: 'builtin',
      agent: id,
    },
  }
}

function customAgent(overrides: {
  id?: string
  label?: string
  startCommand: string
  resumeCommand?: string
}): AgentDefinition {
  return {
    id: overrides.id ?? 'gemini',
    label: overrides.label ?? 'Gemini CLI',
    kind: 'custom',
    capabilities: {
      terminal: true,
      inAppChat: false,
      conversationHistory: false,
      interrupt: false,
      resume: overrides.resumeCommand !== undefined,
    },
    implementation: {
      type: 'custom',
      config: {
        label: overrides.label ?? 'Gemini CLI',
        startCommand: overrides.startCommand,
        ...(overrides.resumeCommand ? { resumeCommand: overrides.resumeCommand } : {}),
      },
    },
  }
}

describe('agent-service command builders', () => {
  it('builds a managed shell command that sources runtime.env', () => {
    const command = buildManagedShellCommand('/tmp/gitdir/portta/runtime.env', '/bin/zsh')
    expect(command).toContain('bash -lc')
    expect(command).toContain('/tmp/gitdir/portta/runtime.env')
    expect(command).toContain('set -a')
    expect(command).toContain('set +a')
    expect(command).toContain('/bin/zsh')
  })

  it('builds a managed Runtime pane command that sources runtime.env before launching', () => {
    const command = buildManagedRuntimePaneCommand(
      '/tmp/gitdir/portta/runtime.env',
      'portta flow environment "$PORTTA_FLOW_BRANCH" monitor',
    )

    expect(command).toContain('bash -lc')
    expect(command).toContain('/tmp/gitdir/portta/runtime.env')
    expect(command).toContain('set -a')
    expect(command).toContain('set +a')
    expect(command).toContain('portta flow environment "$PORTTA_FLOW_BRANCH" monitor')
  })

  it('wraps built-in agent commands with runtime.env loading', () => {
    const claude = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      prompt: 'fix the tests',
    })

    expect(claude).toContain('/tmp/gitdir/portta/runtime.env')
    expect(claude).toContain('set -a')
    expect(claude).toContain('set +a')
    expect(claude).toContain('claude')
    expect(claude).toContain('fix the tests')
    expect(claude).not.toContain('--continue')
  })

  it('configures both Codex hooks and the managed turn-completion notification', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      prompt: 'fix the tests',
    })

    expect(command).toContain('codex --enable hooks')
    expect(command).toContain(`notify=["/tmp/gitdir/portta/portta-agentctl","codex-notify"]`)
  })

  it('uses Codex automatic approval review for unattended launches', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      permissionMode: 'auto-review',
      prompt: 'fix the tests',
    })

    expect(command).toContain('--approve-for-me')
    expect(command).not.toContain('--yolo')
    expect(command).toContain('--enable hooks')
    expect(command).toContain("PORTTA_FLOW_AGENT_PERMISSION_MODE='auto-review'")
  })

  it('uses claude continue on resume and skips system prompt; no prompt = no replay', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      systemPrompt: 'stay focused',
      launchMode: 'resume',
    })

    expect(command).toContain('claude --dangerously-skip-permissions --continue')
    expect(command).not.toContain('--append-system-prompt')
    expect(command).not.toContain('stay focused')
    expect(command).not.toContain(' -- ')
  })

  it('appends the follow-up prompt to claude --continue when one is provided', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      prompt: 'fix the tests',
      launchMode: 'resume',
    })

    expect(command).toContain("claude --dangerously-skip-permissions --continue -- 'fix the tests'")
  })

  it('resumes a specific claude session by id when one is provided', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      launchMode: 'resume',
      resumeConversationId: 'sess-123',
    })

    expect(command).toContain("claude --dangerously-skip-permissions --resume 'sess-123'")
    expect(command).not.toContain('--continue')
  })

  it('forks a claude session and pins the child session id', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      launchMode: 'fork',
      forkFromSessionId: 'root-abc',
      pinSessionId: 'child-xyz',
    })

    expect(command).toContain(
      "claude --dangerously-skip-permissions --resume 'root-abc' --fork-session --session-id 'child-xyz'",
    )
  })

  it('forks a codex session via the fork subcommand', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      launchMode: 'fork',
      forkFromSessionId: 'root-abc',
    })

    expect(command).toMatch(/codex .* fork 'root-abc'/)
    expect(command).toContain('--enable hooks')
    expect(command).not.toContain('--session-id')
  })

  it('resumes a specific codex session by id', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      launchMode: 'resume',
      resumeConversationId: 'thread-9',
    })

    expect(command).toMatch(/codex .* resume 'thread-9'/)
  })

  it('builds docker commands that exec inside the container', () => {
    const shell = buildDockerShellCommand(
      'taskflow-feature-container',
      '/repos/feature',
      '/repos/main/.git/worktrees/feature/portta/runtime.env',
      '/bin/zsh',
    )
    const agent = buildDockerAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/repos/main/.git/worktrees/feature/portta/runtime.env',
      repoRoot: '/repos/main',
      worktreePath: '/repos/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      prompt: 'ship the fix',
    })

    expect(shell).toContain("docker exec -it -w '/repos/feature' 'taskflow-feature-container' /bin/sh -c")
    expect(shell).toContain('/bin/zsh')
    expect(shell).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"')
    expect(agent).toMatch(/codex .* --yolo/)
    expect(agent).toContain('ship the fix')
    expect(agent).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"')
    expect(agent).not.toContain('docker exec')
  })

  it('builds a Docker Runtime pane command in the container and worktree', () => {
    const command = buildDockerRuntimePaneCommand(
      'taskflow-feature-container',
      '/repos/feature',
      '/repos/main/.git/worktrees/feature/portta/runtime.env',
      'portta flow environment "$PORTTA_FLOW_BRANCH" monitor',
    )

    expect(command).toContain("docker exec -it -w '/repos/feature' 'taskflow-feature-container' /bin/sh -c")
    expect(command).toContain('/repos/main/.git/worktrees/feature/portta/runtime.env')
    expect(command).toContain('portta flow environment "$PORTTA_FLOW_BRANCH" monitor')
    expect(command).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"')
  })

  it('defaults docker shell commands to /bin/bash instead of the host shell path', () => {
    const shell = buildDockerShellCommand(
      'taskflow-feature-container',
      '/repos/feature',
      '/repos/main/.git/worktrees/feature/portta/runtime.env',
    )

    expect(shell).toContain('/bin/bash')
    expect(shell).not.toContain(' /bin/sh -lc ')
    expect(shell).toContain('export PATH="$PATH:/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin"')
  })

  it('falls back to /bin/sh when the preferred docker shell is unavailable', () => {
    const shell = buildDockerShellCommand(
      'taskflow-feature-container',
      '/repos/feature',
      '/repos/main/.git/worktrees/feature/portta/runtime.env',
      '/missing/bash',
    )

    expect(shell).toContain('/missing/bash')
    expect(shell).toContain('elif [ -x /bin/sh ]; then exec /bin/sh -i;')
  })

  it('uses codex resume --last and skips developer_instructions; no prompt = no replay', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      systemPrompt: 'stay focused',
      launchMode: 'resume',
    })

    expect(command).toMatch(/codex .* --yolo resume --last/)
    expect(command).not.toContain('developer_instructions=')
    expect(command).not.toContain('stay focused')
    expect(command).not.toContain(' -- ')
  })

  it('appends the follow-up prompt to codex resume --last when one is provided', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      prompt: 'ship the fix',
      launchMode: 'resume',
    })

    expect(command).toMatch(/codex .* --yolo resume --last -- 'ship the fix'/)
  })

  it('uses an explicit Codex conversation id when refreshing a terminal', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
      launchMode: 'resume',
      resumeConversationId: 'thread-refresh',
    })

    expect(command).toMatch(/codex .* --yolo resume 'thread-refresh'/)
    expect(command).not.toContain('resume --last')
  })

  it('uses -- before the prompt so dash-prefixed prompts are not parsed as flags', () => {
    const claude = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      prompt: '--- fix the bug',
    })
    expect(claude).toContain("-- '--- fix the bug'")

    const codex = buildAgentPaneCommand({
      agent: builtInAgent('codex'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      prompt: '--help',
    })
    expect(codex).toContain("-- '--help'")
    expect(codex).toContain('codex --enable hooks')
  })

  it('omits -- when no prompt is provided', () => {
    const command = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      systemPrompt: 'be helpful',
    })
    expect(command).not.toContain(' -- ')
  })

  it('adds the claude permissions bypass flag only when profile yolo is enabled', () => {
    const normal = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
    })
    const yolo = buildAgentPaneCommand({
      agent: builtInAgent('claude'),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature',
      profileName: 'default',
      yolo: true,
    })

    expect(normal).not.toContain('--dangerously-skip-permissions')
    expect(yolo).toContain('--dangerously-skip-permissions')
  })

  it('renders custom agent placeholders through exported env vars', () => {
    const command = buildAgentPaneCommand({
      agent: customAgent({
        startCommand: 'gemini --prompt "${PROMPT}" --cwd "${WORKTREE_PATH}" --profile "${PROFILE}"',
      }),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature/search',
      profileName: 'sandbox',
      prompt: 'fix the tests',
    })

    expect(command).toContain("export PORTTA_FLOW_AGENT_PROMPT='fix the tests'")
    expect(command).toContain("export PORTTA_FLOW_AGENT_WORKTREE_PATH='/repo/__worktrees/feature'")
    expect(command).toContain("export PORTTA_FLOW_AGENT_PROFILE='sandbox'")
    expect(command).toContain(
      'gemini --prompt "$PORTTA_FLOW_AGENT_PROMPT" --cwd "$PORTTA_FLOW_AGENT_WORKTREE_PATH" --profile "$PORTTA_FLOW_AGENT_PROFILE"',
    )
  })

  it('uses a custom agent resume command when available', () => {
    const command = buildAgentPaneCommand({
      agent: customAgent({
        startCommand: 'gemini start --prompt "${PROMPT}"',
        resumeCommand: 'gemini resume --branch "${BRANCH}"',
      }),
      runtimeEnvPath: '/tmp/gitdir/portta/runtime.env',
      repoRoot: '/repo',
      worktreePath: '/repo/__worktrees/feature',
      branch: 'feature/search',
      profileName: 'default',
      prompt: 'fix the tests',
      launchMode: 'resume',
    })

    expect(command).toContain('gemini resume --branch "$PORTTA_FLOW_AGENT_BRANCH"')
    expect(command).not.toContain('gemini start --prompt "$PORTTA_FLOW_AGENT_PROMPT"')
  })
})
