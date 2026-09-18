import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectPaths } from 'portta-core/taskflow/paths'
import { afterEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../adapters/config.ts'
import {
  buildInitAgentCommand,
  buildStarterTemplate,
  detectInitEnvironment,
  detectInitProjectContext,
  parseInitAgentStreamLine,
} from '../services/init-authoring.ts'

describe('buildInitAgentCommand', () => {
  const prompt = {
    systemPrompt: 'system',
    userPrompt: 'user',
  }

  it('builds the Claude non-interactive command', () => {
    expect(buildInitAgentCommand('claude', prompt)).toEqual({
      agent: 'claude',
      cmd: 'claude',
      args: [
        '-p',
        '--verbose',
        '--safe-mode',
        '--disable-slash-commands',
        '--no-session-persistence',
        '--permission-mode',
        'bypassPermissions',
        '--model',
        'haiku',
        '--effort',
        'low',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--append-system-prompt',
        'system',
        'user',
      ],
    })
  })

  it('builds the Codex non-interactive command with a summary path', () => {
    const command = buildInitAgentCommand('codex', prompt, 'test-init')

    expect(command.agent).toBe('codex')
    expect(command.cmd).toBe('codex')
    expect(command.summaryPath).toContain('test-init-')
    expect(command.args).toContain('exec')
    expect(command.args).toContain('--json')
    expect(command.args).toContain('--sandbox')
    expect(command.args).toContain('workspace-write')
    expect(command.args).toContain('--ignore-user-config')
    expect(command.args).toContain('--ignore-rules')
    expect(command.args).toContain('--ephemeral')
    expect(command.args).not.toContain('-m')
    expect(command.args).toContain('-o')
    expect(command.args).toContain('-c')
    expect(command.args).toContain('model_reasoning_effort="low"')
    expect(command.args).toContain('developer_instructions=system')
    expect(command.args.at(-1)).toBe('user')
  })
})

describe('parseInitAgentStreamLine', () => {
  it('streams Claude text deltas and tool statuses', () => {
    const state = { assistantSnapshot: '', lastStatus: null }

    expect(
      parseInitAgentStreamLine(
        'claude',
        JSON.stringify({
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'Hello' },
        }),
        state,
      ),
    ).toEqual([{ kind: 'assistant_delta', text: 'Hello' }])

    expect(
      parseInitAgentStreamLine(
        'claude',
        JSON.stringify({
          type: 'content_block_start',
          content_block: { type: 'tool_use', name: 'Read' },
        }),
        state,
      ),
    ).toEqual([{ kind: 'status', text: 'Using Read...' }])
  })

  it('streams Codex deltas and command statuses', () => {
    const state = { assistantSnapshot: '', lastStatus: null }

    expect(
      parseInitAgentStreamLine(
        'codex',
        JSON.stringify({
          type: 'response.output_text.delta',
          delta: 'Hello',
        }),
        state,
      ),
    ).toEqual([{ kind: 'assistant_delta', text: 'Hello' }])

    expect(
      parseInitAgentStreamLine(
        'codex',
        JSON.stringify({
          type: 'exec.command.started',
          command: ['rg', 'PORT'],
        }),
        state,
      ),
    ).toEqual([{ kind: 'status', text: 'Running rg PORT' }])
  })

  it('emits only the new suffix for snapshot-style assistant payloads', () => {
    const state = { assistantSnapshot: '', lastStatus: null }

    expect(
      parseInitAgentStreamLine(
        'claude',
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello' }],
          },
        }),
        state,
      ),
    ).toEqual([{ kind: 'assistant_delta', text: 'Hello' }])

    expect(
      parseInitAgentStreamLine(
        'claude',
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello world' }],
          },
        }),
        state,
      ),
    ).toEqual([{ kind: 'assistant_delta', text: ' world' }])
  })
})

describe('detectInitProjectContext', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('detects the basic starter-template metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-init-helpers-'))
    tempDirs.push(dir)

    nodeTest.spawnSync(['git', 'init', '-b', 'main'], { cwd: dir })
    await nodeTest.write(join(dir, 'bun.lock'), '')
    await nodeTest.write(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'example-project',
      }),
    )

    const context = detectInitProjectContext(dir, 'claude')

    expect(context.projectName).toBe('example-project')
    expect(context.packageManager).toBe('bun')
    expect(context.mainBranch).toBe('main')
    expect(context.defaultAgent).toBe('claude')
  })

  it('uses the current checkout as the default worktree base', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-init-current-branch-'))
    tempDirs.push(dir)

    nodeTest.spawnSync(['git', 'init', '-b', 'main'], { cwd: dir })
    nodeTest.spawnSync(['git', 'config', 'user.email', 'taskflow@example.test'], { cwd: dir })
    nodeTest.spawnSync(['git', 'config', 'user.name', 'Taskflow Test'], { cwd: dir })
    await nodeTest.write(join(dir, 'README.md'), 'fixture\n')
    nodeTest.spawnSync(['git', 'add', 'README.md'], { cwd: dir })
    nodeTest.spawnSync(['git', 'commit', '-m', 'initial'], { cwd: dir })
    nodeTest.spawnSync(['git', 'checkout', '-b', 'develop'], { cwd: dir })

    expect(detectInitProjectContext(dir, 'claude').mainBranch).toBe('develop')
  })
})

describe('buildStarterTemplate', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('includes commented examples for the full config surface and still loads', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-starter-template-'))
    tempDirs.push(dir)

    const template = buildStarterTemplate({
      projectName: 'example',
      mainBranch: 'main',
      defaultAgent: 'codex',
      packageManager: 'bun',
    })

    const paths = projectPaths(dir)
    await mkdir(paths.root, { recursive: true })
    await nodeTest.write(paths.config, template)

    const config = loadConfig(dir, { resolvedRoot: true })

    expect(config.name).toBe('example')
    expect(config.workspace.mainBranch).toBe('main')
    expect(config.workspace.worktrees.root).toBe('.portta/worktrees')
    expect(config.workspace.defaultAgent).toBe('codex')
    expect(config.services).toEqual([])
    expect(config.exposure.local).toEqual({
      provider: 'loopback',
      autoExpose: 'all',
    })
    expect(config.profiles.default!.panes).toEqual([
      {
        id: 'agent',
        kind: 'agent',
        focus: true,
      },
      {
        id: 'runtime',
        kind: 'runtime',
        split: 'right',
        sizePct: 30,
        cwd: 'worktree',
      },
    ])
    expect(config.profiles.default!.environment).toEqual({ provider: 'auto' })
    expect(config.integrations.github.linkedRepos).toEqual([])
    expect(config.integrations.linear.enabled).toBe(true)
  })
})

describe('detectInitEnvironment', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  })

  it('prefers a valid Dev Container over Compose and accepts a deterministic override', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-init-detection-'))
    tempDirs.push(dir)
    await mkdir(join(dir, '.devcontainer'), { recursive: true })
    await nodeTest.write(join(dir, '.devcontainer', 'devcontainer.json'), '{}')
    await nodeTest.write(join(dir, 'compose.yaml'), 'services: {}')

    expect(detectInitEnvironment(dir).selectedRuntime).toBe('devcontainer')
    expect(detectInitEnvironment(dir, 'compose').selectedRuntime).toBe('compose')
  })

  it('detects a Dockerfile when no higher-priority environment exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'taskflow-init-dockerfile-'))
    tempDirs.push(dir)
    await nodeTest.write(join(dir, 'Dockerfile'), 'FROM alpine\nEXPOSE 3000\n')

    expect(detectInitEnvironment(dir)).toMatchObject({ dockerfile: true, selectedRuntime: 'dockerfile' })
  })
})
