import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildProjectSessionName, sanitizeNameSegment } from '../adapters/session-gateway.ts'
import { chooseUtf8Locale, parseWindowSummaries, pickTmuxLocale } from '../adapters/tmux.ts'

const isolatedTmuxScriptPath = new URL('../../../../tests/support/run-with-isolated-tmux.sh', import.meta.url).pathname
const nodeTestSetupUrl = new URL('../../../../tests/support/vitest-node-setup.ts', import.meta.url).href

function buildEnv(overrides: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  return {
    ...env,
    ...overrides,
  }
}

function read(args: string[], env?: Record<string, string>): string {
  const result = nodeTest.spawnSync(args, { env, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) {
    const stderr = new TextDecoder().decode(result.stderr).trim()
    throw new Error(`${args.join(' ')} failed: ${stderr || `exit ${result.exitCode}`}`)
  }

  return new TextDecoder().decode(result.stdout).trim()
}

function readWithIsolatedTmux(args: string[], env?: Record<string, string>): string {
  return read(['bash', isolatedTmuxScriptPath, ...args], env)
}

interface LayoutResult {
  globalPaneBaseIndex: string
  relatedPaneIndexes: string[]
  unrelatedPaneIndexes: string[]
}

interface ManagedSessionResult {
  sessions: string[]
  destroyUnattached: string
}

function parseLayoutResult(output: string): LayoutResult {
  const value: unknown = JSON.parse(output)
  if (!value || typeof value !== 'object') {
    throw new Error('layout result must be an object')
  }

  const { globalPaneBaseIndex, relatedPaneIndexes, unrelatedPaneIndexes } = value as {
    globalPaneBaseIndex?: unknown
    relatedPaneIndexes?: unknown
    unrelatedPaneIndexes?: unknown
  }

  if (typeof globalPaneBaseIndex !== 'string') {
    throw new Error('layout result globalPaneBaseIndex must be a string')
  }
  if (!Array.isArray(relatedPaneIndexes) || !relatedPaneIndexes.every((entry) => typeof entry === 'string')) {
    throw new Error('layout result relatedPaneIndexes must be a string array')
  }
  if (!Array.isArray(unrelatedPaneIndexes) || !unrelatedPaneIndexes.every((entry) => typeof entry === 'string')) {
    throw new Error('layout result unrelatedPaneIndexes must be a string array')
  }

  return {
    globalPaneBaseIndex,
    relatedPaneIndexes,
    unrelatedPaneIndexes,
  }
}

function parseManagedSessionResult(output: string): ManagedSessionResult {
  const value: unknown = JSON.parse(output)
  if (!value || typeof value !== 'object') {
    throw new Error('managed session result must be an object')
  }

  const { sessions, destroyUnattached } = value as {
    sessions?: unknown
    destroyUnattached?: unknown
  }

  if (!Array.isArray(sessions) || !sessions.every((entry) => typeof entry === 'string')) {
    throw new Error('managed session result sessions must be a string array')
  }
  if (typeof destroyUnattached !== 'string') {
    throw new Error('managed session result destroyUnattached must be a string')
  }

  return {
    sessions,
    destroyUnattached,
  }
}

function parseGlobalEnvResult(output: string): { hasLeaked: boolean; hasKept: boolean } {
  const value: unknown = JSON.parse(output)
  if (!value || typeof value !== 'object') {
    throw new Error('global env result must be an object')
  }
  const { hasLeaked, hasKept } = value as { hasLeaked?: unknown; hasKept?: unknown }
  if (typeof hasLeaked !== 'boolean' || typeof hasKept !== 'boolean') {
    throw new Error('global env result must have boolean hasLeaked and hasKept')
  }
  return { hasLeaked, hasKept }
}

describe('sanitizeNameSegment', () => {
  it('normalizes arbitrary path-like input', () => {
    expect(sanitizeNameSegment('Taskflow Web/Desktop')).toBe('taskflow-web-desktop')
  })

  it('falls back to x for empty sanitization', () => {
    expect(sanitizeNameSegment('////')).toBe('x')
  })
})

describe('buildProjectSessionName', () => {
  it('is deterministic for the same repo root', () => {
    const a = buildProjectSessionName('/tmp/my-project')
    const b = buildProjectSessionName('/tmp/my-project')
    expect(a).toBe(b)
  })

  it('changes across different repo roots', () => {
    expect(buildProjectSessionName('/tmp/project-a')).not.toBe(buildProjectSessionName('/tmp/project-b'))
  })
})

describe('parseWindowSummaries', () => {
  it('parses tmux list-windows output', () => {
    const output = ['tf-project-a1b2c3d4\ttf-main\t2', 'tf-project-a1b2c3d4\ttf-feature/search\t3'].join('\n')

    expect(parseWindowSummaries(output)).toEqual([
      {
        sessionName: 'tf-project-a1b2c3d4',
        windowName: 'tf-main',
        paneCount: 2,
      },
      {
        sessionName: 'tf-project-a1b2c3d4',
        windowName: 'tf-feature/search',
        paneCount: 3,
      },
    ])
  })
})

describe('pickTmuxLocale', () => {
  it('uses the host fallback when no locale is set', () => {
    expect(pickTmuxLocale({}, 'C.UTF-8')).toBe('C.UTF-8')
  })

  it('uses the host fallback when the inherited locale is not UTF-8', () => {
    expect(pickTmuxLocale({ LANG: 'C' }, 'C.UTF-8')).toBe('C.UTF-8')
    expect(pickTmuxLocale({ LC_ALL: 'POSIX' }, 'en_US.UTF-8')).toBe('en_US.UTF-8')
  })

  it('keeps an inherited UTF-8 locale (any spelling), ignoring the fallback', () => {
    expect(pickTmuxLocale({ LANG: 'en_US.UTF-8' }, 'C.UTF-8')).toBe('en_US.UTF-8')
    expect(pickTmuxLocale({ LANG: 'C.UTF-8' }, 'en_US.UTF-8')).toBe('C.UTF-8')
    expect(pickTmuxLocale({ LANG: 'en_GB.utf8' }, 'C.UTF-8')).toBe('en_GB.utf8')
  })

  it('prefers LC_ALL, then LC_CTYPE, then LANG', () => {
    expect(pickTmuxLocale({ LC_ALL: 'en_US.UTF-8', LANG: 'C' }, 'C.UTF-8')).toBe('en_US.UTF-8')
    expect(pickTmuxLocale({ LC_CTYPE: 'de_DE.UTF-8', LANG: 'C' }, 'C.UTF-8')).toBe('de_DE.UTF-8')
  })
})

describe('chooseUtf8Locale', () => {
  it('prefers a neutral C.UTF-8 when available (macOS spelling)', () => {
    expect(chooseUtf8Locale(['C', 'C.UTF-8', 'en_US.UTF-8', 'POSIX'])).toBe('C.UTF-8')
  })

  it('prefers C.utf8 (glibc spelling) and returns the exact listed name', () => {
    expect(chooseUtf8Locale(['C', 'C.utf8', 'en_US.utf8'])).toBe('C.utf8')
  })

  it('falls back to en_US.UTF-8 when C.UTF-8 is absent (older macOS)', () => {
    expect(chooseUtf8Locale(['C', 'POSIX', 'en_US.UTF-8', 'fr_FR.UTF-8'])).toBe('en_US.UTF-8')
  })

  it('uses any UTF-8 locale when no preferred one is present', () => {
    expect(chooseUtf8Locale(['C', 'de_DE.UTF-8'])).toBe('de_DE.UTF-8')
  })

  it('last-resorts to C.UTF-8 when nothing UTF-8 is listed or the list is empty', () => {
    expect(chooseUtf8Locale(['C', 'POSIX'])).toBe('C.UTF-8')
    expect(chooseUtf8Locale([])).toBe('C.UTF-8')
  })
})

describe('ensureSessionLayout', () => {
  it('shows Runtime output without echoing its launch command', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-runtime-output-'))
    const runnerPath = join(testRoot, 'runtime-output.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    const sessionGatewayModuleUrl = new URL('../adapters/session-gateway.ts', import.meta.url).href
    const sessionServiceModuleUrl = new URL('../services/session-service.ts', import.meta.url).href

    await nodeTest.write(
      runnerPath,
      [
        'import { setTimeout as sleep } from "node:timers/promises";',
        `import { ensureSessionLayout, planSessionLayout } from ${JSON.stringify(sessionServiceModuleUrl)};`,
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        `import { buildProjectSessionName, buildWorktreeWindowName } from ${JSON.stringify(sessionGatewayModuleUrl)};`,
        '',
        'function read(args: string[]): string {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '  return new TextDecoder().decode(result.stdout);',
        '}',
        '',
        'const projectRoot = process.argv[2];',
        'if (!projectRoot) throw new Error("expected projectRoot");',
        'const branch = "feature/runtime-output";',
        'const gateway = new TmuxGateway();',
        'const plan = planSessionLayout(',
        '  projectRoot,',
        '  branch,',
        '  [{ id: "runtime", kind: "runtime", focus: true }],',
        '  {',
        '    repoRoot: projectRoot,',
        '    worktreePath: projectRoot,',
        '    paneCommands: {',
        '      agent: "agent",',
        '      shell: "sh",',
        `      runtime: ${JSON.stringify("printf 'runtime-ready\\n'; exec sh -i")},`,
        '    },',
        '  },',
        ');',
        'await ensureSessionLayout(gateway, plan);',
        'await sleep(100);',
        'const target = `${buildProjectSessionName(projectRoot)}:${buildWorktreeWindowName(branch)}`;',
        'console.log(read(["tmux", "capture-pane", "-p", "-t", target, "-S", "-"]));',
      ].join('\n'),
    )

    try {
      const output = readWithIsolatedTmux([
        process.execPath,
        '--import',
        'tsx',
        '--import',
        nodeTestSetupUrl,
        runnerPath,
        testRoot,
      ])
      expect(output).toContain('runtime-ready')
      expect(output).not.toContain("printf 'runtime-ready")
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('keeps the tmux global default at 1 while forcing the Taskflow window to 0-based panes', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-'))
    const configPath = join(testRoot, 'tmux.conf')
    const projectRoot = join(testRoot, 'repo')
    const worktreePath = join(projectRoot, '__worktrees', 'feature-search')
    await mkdir(worktreePath, { recursive: true })

    await nodeTest.write(configPath, 'set -g base-index 1\nsetw -g pane-base-index 1\n')
    const runnerPath = join(testRoot, 'run-layout.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    const sessionGatewayModuleUrl = new URL('../adapters/session-gateway.ts', import.meta.url).href
    const sessionServiceModuleUrl = new URL('../services/session-service.ts', import.meta.url).href

    await nodeTest.write(
      runnerPath,
      [
        `import { ensureSessionLayout, planSessionLayout } from ${JSON.stringify(sessionServiceModuleUrl)};`,
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        `import { buildProjectSessionName, buildWorktreeWindowName } from ${JSON.stringify(sessionGatewayModuleUrl)};`,
        '',
        'function run(args: string[]): void {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '}',
        '',
        'function read(args: string[]): string {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '  return new TextDecoder().decode(result.stdout).trim();',
        '}',
        '',
        'const projectRoot = process.argv[2];',
        'const worktreePath = process.argv[3];',
        'if (!projectRoot || !worktreePath) throw new Error("expected projectRoot and worktreePath");',
        '',
        'const gateway = new TmuxGateway();',
        'const plan = planSessionLayout(',
        '  projectRoot,',
        '  "feature/search",',
        '  [',
        '    { id: "agent", kind: "agent", focus: true },',
        '    { id: "shell", kind: "shell", split: "right", sizePct: 25 },',
        '  ],',
        '  {',
        '    repoRoot: projectRoot,',
        '    worktreePath,',
        '    paneCommands: {',
        '      agent: "printf agent-started",',
        '      shell: "sh",',
        '    },',
        '  },',
        ');',
        '',
        'await ensureSessionLayout(gateway, plan);',
        'run(["tmux", "new-session", "-d", "-s", "unrelated", "-c", projectRoot]);',
        'run(["tmux", "new-window", "-d", "-t", "unrelated", "-n", "plain", "-c", projectRoot]);',
        '',
        'console.log(JSON.stringify({',
        '  globalPaneBaseIndex: read(["tmux", "show-options", "-g", "-w", "-v", "pane-base-index"]),',
        '  relatedPaneIndexes: read(["tmux", "list-panes", "-t", `${buildProjectSessionName(projectRoot)}:${buildWorktreeWindowName("feature/search")}`, "-F", "#{pane_index}"]).split("\\n").filter(Boolean),',
        '  unrelatedPaneIndexes: read(["tmux", "list-panes", "-t", "unrelated:plain", "-F", "#{pane_index}"]).split("\\n").filter(Boolean),',
        '}));',
        '',
      ].join('\n'),
    )

    try {
      const result = parseLayoutResult(
        readWithIsolatedTmux(
          [process.execPath, '--import', 'tsx', '--import', nodeTestSetupUrl, runnerPath, projectRoot, worktreePath],
          buildEnv({ PORTTA_FLOW_ISOLATED_TMUX_CONFIG: configPath }),
        ),
      )
      expect(result.globalPaneBaseIndex).toBe('1')
      expect(result.relatedPaneIndexes).toEqual(['0', '1'])
      expect(result.unrelatedPaneIndexes).toEqual(['1'])
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })
})

describe('TmuxGateway', () => {
  it('launches a long command before the interactive shell is ready', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-long-command-'))
    const markerPath = join(testRoot, 'marker.txt')
    const runnerPath = join(testRoot, 'long-command.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    const sessionGatewayModuleUrl = new URL('../adapters/session-gateway.ts', import.meta.url).href
    await nodeTest.write(
      runnerPath,
      [
        'import { readFile } from "node:fs/promises";',
        'import { setTimeout as sleep } from "node:timers/promises";',
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        `import { buildPaneTarget } from ${JSON.stringify(sessionGatewayModuleUrl)};`,
        '',
        'const markerPath = process.argv[2];',
        'if (!markerPath) throw new Error("expected marker path");',
        'const sessionName = "tf-long-command";',
        'const windowName = "tf-test";',
        'const gateway = new TmuxGateway();',
        'await gateway.ensureServer();',
        'await gateway.ensureSession(sessionName, process.cwd());',
        'await gateway.createWindow({ sessionName, windowName, cwd: process.cwd(), command: "bash -lc \'exec zsh -i\'" });',
        `const payload = ${JSON.stringify('x'.repeat(5_000))};`,
        "await gateway.runCommand(buildPaneTarget(sessionName, windowName, 0), `printf '%s' '${payload}' > '${markerPath}'`, { replaceShell: true });",
        'let contents = "";',
        'for (let attempt = 0; attempt < 20; attempt += 1) {',
        '  contents = await readFile(markerPath, "utf8").catch(() => "");',
        '  if (contents.length === payload.length) break;',
        '  await sleep(50);',
        '}',
        'console.log(contents.length);',
      ].join('\n'),
    )

    try {
      expect(
        readWithIsolatedTmux([
          process.execPath,
          '--import',
          'tsx',
          '--import',
          nodeTestSetupUrl,
          runnerPath,
          markerPath,
        ]),
      ).toContain('5000')
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('keeps managed sessions alive when the user tmux config enables destroy-unattached', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-destroy-unattached-'))
    const projectRoot = join(testRoot, 'repo')
    const configPath = join(testRoot, 'tmux.conf')
    const runnerPath = join(testRoot, 'ensure-session.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    await mkdir(projectRoot, { recursive: true })
    await nodeTest.write(configPath, 'set-option -g destroy-unattached on\n')
    await nodeTest.write(
      runnerPath,
      [
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        '',
        'function read(args: string[]): string {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '  return new TextDecoder().decode(result.stdout).trim();',
        '}',
        '',
        'const projectRoot = process.argv[2];',
        'if (!projectRoot) throw new Error("expected projectRoot");',
        'const sessionName = "tf-managed";',
        'const gateway = new TmuxGateway();',
        'await gateway.ensureServer();',
        'await gateway.ensureSession(sessionName, projectRoot);',
        'console.log(JSON.stringify({',
        '  sessions: read(["tmux", "list-sessions", "-F", "#{session_name}"]).split("\\n").filter(Boolean),',
        '  destroyUnattached: read(["tmux", "show-options", "-t", sessionName, "-v", "destroy-unattached"]),',
        '}));',
      ].join('\n'),
    )

    try {
      const result = parseManagedSessionResult(
        readWithIsolatedTmux(
          [process.execPath, '--import', 'tsx', '--import', nodeTestSetupUrl, runnerPath, projectRoot],
          buildEnv({ PORTTA_FLOW_ISOLATED_TMUX_CONFIG: configPath }),
        ),
      )
      expect(result.sessions).toEqual(['tf-managed'])
      expect(result.destroyUnattached).toBe('off')
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('keeps launch-project .env keys out of the tmux global environment', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-env-leak-'))
    const projectRoot = join(testRoot, 'repo')
    const runnerPath = join(testRoot, 'ensure-session.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    await mkdir(projectRoot, { recursive: true })
    await nodeTest.write(
      runnerPath,
      [
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        '',
        'function read(args: string[]): string {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe" });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '  return new TextDecoder().decode(result.stdout).trim();',
        '}',
        '',
        'const projectRoot = process.argv[2];',
        'if (!projectRoot) throw new Error("expected projectRoot");',
        'const gateway = new TmuxGateway();',
        // ensureServer + ensureSession is the path that first creates a persistent
        // server, capturing this process's env into the tmux global environment.
        'await gateway.ensureServer();',
        'await gateway.ensureSession("tf-env-leak", projectRoot);',
        'const globalEnv = read(["tmux", "show-environment", "-g"]).split("\\n");',
        'console.log(JSON.stringify({',
        '  hasLeaked: globalEnv.some((line) => line.startsWith("LEAKED_PROJECT_SECRET=")),',
        '  hasKept: globalEnv.some((line) => line.startsWith("KEPT_SHELL_VAR=")),',
        '}));',
      ].join('\n'),
    )

    try {
      const result = parseGlobalEnvResult(
        readWithIsolatedTmux(
          [process.execPath, '--import', 'tsx', '--import', nodeTestSetupUrl, runnerPath, projectRoot],
          buildEnv({
            PORTTA_FLOW_PROJECT_ENV_KEYS: 'LEAKED_PROJECT_SECRET',
            LEAKED_PROJECT_SECRET: 'service-role-key',
            KEPT_SHELL_VAR: 'ok',
          }),
        ),
      )
      // The project .env key is stripped from the env used to spawn tmux, so the
      // server is born without it in the global environment...
      expect(result.hasLeaked).toBe(false)
      // ...while unrelated inherited vars are still passed through normally.
      expect(result.hasKept).toBe(true)
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('scrubs launch-project .env keys left in the global env by an already-running server', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-env-scrub-'))
    const projectRoot = join(testRoot, 'repo')
    const runnerPath = join(testRoot, 'scrub.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    await mkdir(projectRoot, { recursive: true })
    await nodeTest.write(
      runnerPath,
      [
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        '',
        'function run(args: string[], env?: Record<string, string>): void {',
        '  const result = nodeTest.spawnSync(args, { stdout: "pipe", stderr: "pipe", ...(env ? { env } : {}) });',
        '  if (result.exitCode !== 0) {',
        '    const stderr = new TextDecoder().decode(result.stderr).trim();',
        '    throw new Error(`${args.join(" ")} failed: ${stderr || `exit ${result.exitCode}`}`);',
        '  }',
        '}',
        '',
        'function globalHasLeaked(): boolean {',
        '  const result = nodeTest.spawnSync(["tmux", "show-environment", "-g"], { stdout: "pipe", stderr: "pipe" });',
        '  return new TextDecoder().decode(result.stdout).split("\\n").some((line) => line.startsWith("LEAKED_PROJECT_SECRET="));',
        '}',
        '',
        'const projectRoot = process.argv[2];',
        'if (!projectRoot) throw new Error("expected projectRoot");',
        // Simulate a server started before the stripped-env fix: its global env
        // captured the leaked key. gateway commands never spawn with it set, so
        // only the scrub can remove it. destroy-unattached off keeps this
        // detached session (and thus the server + its global env) alive even when
        // the tmux config enables destroy-unattached.
        'run(["tmux", "new-session", "-d", "-s", "preexisting", "-c", projectRoot, ";", "set-option", "-t", "preexisting", "destroy-unattached", "off"], { ...process.env, LEAKED_PROJECT_SECRET: "service-role-key" } as Record<string, string>);',
        'const before = globalHasLeaked();',
        'const gateway = new TmuxGateway();',
        'await gateway.ensureServer();',
        'await gateway.ensureSession("tf-scrub", projectRoot);',
        'console.log(JSON.stringify({ before, after: globalHasLeaked() }));',
      ].join('\n'),
    )

    try {
      const output = readWithIsolatedTmux(
        [process.execPath, '--import', 'tsx', '--import', nodeTestSetupUrl, runnerPath, projectRoot],
        buildEnv({ PORTTA_FLOW_PROJECT_ENV_KEYS: 'LEAKED_PROJECT_SECRET' }),
      )
      const value: unknown = JSON.parse(output)
      const { before, after } = value as { before?: unknown; after?: unknown }
      // The pre-existing server really did leak the key into the global env...
      expect(before).toBe(true)
      // ...and ensureSession's self-heal scrub removed it.
      expect(after).toBe(false)
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })

  it('treats missing windows, sessions, and servers as already closed', async () => {
    const testRoot = await mkdtemp(join(tmpdir(), 'taskflow-tmux-kill-window-'))
    const projectRoot = join(testRoot, 'repo')
    const runnerPath = join(testRoot, 'kill-window.mts')
    const tmuxModuleUrl = new URL('../adapters/tmux.ts', import.meta.url).href
    await mkdir(projectRoot, { recursive: true })
    await nodeTest.write(
      runnerPath,
      [
        `import { TmuxGateway } from ${JSON.stringify(tmuxModuleUrl)};`,
        '',
        'const projectRoot = process.argv[2];',
        'if (!projectRoot) throw new Error("expected projectRoot");',
        'const gateway = new TmuxGateway();',
        'await gateway.killWindow("tf-missing-server", "tf-testing");',
        'await gateway.ensureSession("tf-existing", projectRoot);',
        'await gateway.killWindow("tf-existing", "tf-missing-window");',
        'await gateway.killWindow("tf-missing-session", "tf-testing");',
        'console.log("ok");',
      ].join('\n'),
    )

    try {
      const result = readWithIsolatedTmux([
        process.execPath,
        '--import',
        'tsx',
        '--import',
        nodeTestSetupUrl,
        runnerPath,
        projectRoot,
      ])
      expect(result).toBe('ok')
    } finally {
      await rm(testRoot, { recursive: true, force: true })
    }
  })
})
