import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  requireDocker: vi.fn(),
  inspectContainers: vi.fn(),
  ensureNetwork: vi.fn(),
  networkExists: vi.fn(),
  runProcess: vi.fn(),
  removeApplier: vi.fn(),
  removeRunner: vi.fn(),
  stopMetricsCollector: vi.fn(),
  ensureMetricsCollector: vi.fn(),
  refreshRepositories: vi.fn(),
  ensureApplier: vi.fn(),
  ensureRunner: vi.fn(),
  demoStacksUp: vi.fn(),
  requireDemoStacks: vi.fn(() => []),
  demoStacksDown: vi.fn(),
  ensureDevDemoOwner: vi.fn(),
  waitForPanel: vi.fn(),
  prepareWebUp: vi.fn(),
  finishWebUp: vi.fn(),
  syncForwardAuth: vi.fn(),
  gatewayContext: vi.fn(),
  ensureCheckoutCli: vi.fn(),
  reexecBuiltCli: vi.fn(),
}))

vi.mock('../confirm.js', () => ({ confirm: mocks.confirm }))
vi.mock('../process.js', () => ({ runProcess: mocks.runProcess }))
vi.mock('../docker.js', async () => {
  const actual = await vi.importActual<typeof import('../docker.js')>('../docker.js')
  return {
    ...actual,
    requireDocker: mocks.requireDocker,
    inspectContainers: mocks.inspectContainers,
    ensureNetwork: mocks.ensureNetwork,
    networkExists: mocks.networkExists,
  }
})
vi.mock('../context.js', () => ({
  gatewayContext: mocks.gatewayContext,
  composeArguments: () => ['-f', 'compose.yaml'],
}))
vi.mock('./apply.js', () => ({
  ensureApplier: mocks.ensureApplier,
  removeApplier: mocks.removeApplier,
}))
vi.mock('./runner.js', () => ({
  ensureRunner: mocks.ensureRunner,
  removeRunner: mocks.removeRunner,
}))
vi.mock('./host.js', () => ({
  ensureHostToken: () => null,
  ensureMetricsCollector: mocks.ensureMetricsCollector,
  stopMetricsCollector: mocks.stopMetricsCollector,
}))
vi.mock('./repos.js', () => ({ refreshRepositories: mocks.refreshRepositories }))
vi.mock('./demo.js', () => ({
  demoStacksUp: mocks.demoStacksUp,
  requireDemoStacks: mocks.requireDemoStacks,
  demoStacksDown: mocks.demoStacksDown,
  ensureDevDemoOwner: mocks.ensureDevDemoOwner,
  panelIsReachable: async () => true,
  waitForPanel: mocks.waitForPanel,
}))
vi.mock('./web.js', () => ({
  prepareWebUp: mocks.prepareWebUp,
  finishWebUp: mocks.finishWebUp,
  syncForwardAuth: mocks.syncForwardAuth,
}))
vi.mock('../checkout-cli.js', () => ({
  ensureCheckoutCli: mocks.ensureCheckoutCli,
  reexecBuiltCli: mocks.reexecBuiltCli,
}))

import {
  checkoutLocalEnv,
  clearRegenerableState,
  devCommand,
  downCommand,
  isPorttaOwnedContainer,
  porttaOwnedComposeProjects,
  resetCommand,
  upCommand,
} from './lifecycle.js'

describe('checkout development images', () => {
  it('selects development without leaking a runtime build or image override', () => {
    const values = checkoutLocalEnv()
    expect(values.PORTTA_AUTH_IMAGE).toBe('')
    expect(values.PORTTA_WEB_IMAGE).toBe('')
    expect(values.PORTTA_WEB_BUILD).toBe('false')
    expect(values.PORTTA_WEB_DEV).toBe('true')
  })
})

describe('regenerable checkout snapshots', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('empties git and metrics and leaves credentials alone', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-reset-'))
    roots.push(root)
    mkdirSync(join(root, 'state/git'), { recursive: true })
    mkdirSync(join(root, 'state/metrics'), { recursive: true })
    mkdirSync(join(root, 'state/environment'), { recursive: true })
    mkdirSync(join(root, 'state/auth'), { recursive: true })
    writeFileSync(join(root, 'state/git/index.json'), '{}')
    writeFileSync(join(root, 'state/metrics/host.json'), '{}')
    writeFileSync(join(root, 'state/environment/report.json'), '{}')
    writeFileSync(join(root, 'state/auth/secret'), 'keep')
    writeFileSync(
      join(root, '.env.example'),
      '# Portta environment structure: 1\nPORTTA_AUTH_SECRET=\nPORTTA_RUNTIME_DB_PASSWORD=\n',
    )
    writeFileSync(join(root, '.env'), 'PORTTA_WEB=true\n')

    expect(clearRegenerableState(root)).toEqual(['state/git', 'state/metrics', 'state/environment'])
    expect(existsSync(join(root, 'state/git'))).toBe(true)
    expect(existsSync(join(root, 'state/metrics'))).toBe(true)
    expect(existsSync(join(root, 'state/git/index.json'))).toBe(false)
    expect(existsSync(join(root, 'state/metrics/host.json'))).toBe(false)
    expect(existsSync(join(root, 'state/environment/report.json'))).toBe(false)
    expect(readFileSync(join(root, 'state/auth/secret'), 'utf8')).toBe('keep')
    expect(readFileSync(join(root, '.env'), 'utf8')).toBe('PORTTA_WEB=true\n')
  })
})

describe('resetCommand', () => {
  const roots: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const mock of Object.values(mocks)) mock.mockReset()
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function command(options: Record<string, unknown> = { yes: true, quiet: true }): Command {
    return { optsWithGlobals: () => options, setOptionValueWithSource: vi.fn() } as unknown as Command
  }

  function checkout(): string {
    const root = mkdtempSync(join(tmpdir(), 'portta-reset-'))
    roots.push(root)
    mkdirSync(join(root, 'state/git'), { recursive: true })
    mkdirSync(join(root, 'state/metrics'), { recursive: true })
    mkdirSync(join(root, 'state/environment'), { recursive: true })
    writeFileSync(join(root, 'state/git/index.json'), '{}')
    writeFileSync(join(root, 'state/metrics/host.json'), '{}')
    writeFileSync(join(root, 'state/environment/report.json'), '{}')
    writeFileSync(
      join(root, '.env.example'),
      '# Portta environment structure: 1\nPORTTA_AUTH_SECRET=\nPORTTA_RUNTIME_DB_PASSWORD=\n',
    )
    writeFileSync(join(root, '.env'), 'PORTTA_PROFILE=local\n')
    const context = {
      root,
      env: { PORTTA_PROFILE: 'local' } as NodeJS.ProcessEnv,
      config: {
        profile: 'local' as const,
        projectName: 'portta',
        network: 'portta',
        accessNetwork: 'portta-access',
        tcpEnabled: false,
        webEnabled: true,
        webExpose: 'local' as const,
        tlsEnabled: false,
        domain: 'localhost',
        bindAddress: '127.0.0.1',
        webPort: 8787,
      },
      composeFiles: ['docker/compose/compose.yaml'],
      version: 'test',
    }
    mocks.gatewayContext.mockReturnValue(context)
    return root
  }

  function ok() {
    return { stdout: '', stderr: '', exitCode: 0, failed: false }
  }

  it('stops Portta-managed stacks, drops the panel database, then runs the checkout setup', async () => {
    const root = checkout()
    const order: string[] = []
    mocks.confirm.mockImplementation(async () => {
      order.push('confirm')
    })
    mocks.requireDocker.mockImplementation(async () => {
      order.push('docker')
    })
    mocks.demoStacksDown.mockImplementation(async () => {
      order.push('demos')
    })
    mocks.removeApplier.mockImplementation(async () => {
      order.push('applier')
    })
    mocks.removeRunner.mockImplementation(async () => {
      order.push('runner')
    })
    mocks.stopMetricsCollector.mockImplementation(() => {
      order.push('collector')
    })
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockImplementation(() => {
      order.push('prepare-web')
      return {}
    })
    mocks.finishWebUp.mockImplementation(async () => {
      order.push('dev-web')
    })
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('down') && args.includes('-v')) order.push('gateway-down')
      if (args.includes('up')) order.push('up')
      return ok()
    })

    await resetCommand({}, command())

    expect(mocks.confirm).toHaveBeenCalledWith(
      'stop every Portta-managed stack, drop their volumes, and restart this checkout as if it were new?',
      true,
    )
    expect(mocks.demoStacksDown).toHaveBeenCalledTimes(1)
    expect(order.indexOf('confirm')).toBeLessThan(order.indexOf('demos'))
    expect(order.indexOf('demos')).toBeLessThan(order.indexOf('gateway-down'))
    expect(order.indexOf('gateway-down')).toBeLessThan(order.indexOf('prepare-web'))
    expect(order.indexOf('prepare-web')).toBeLessThan(order.indexOf('up'))
    expect(order.indexOf('up')).toBeLessThan(order.indexOf('dev-web'))
    expect(order.filter((step) => step === 'up')).toHaveLength(1)
    expect(mocks.runProcess).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', 'down', '-v', '--remove-orphans']),
      expect.anything(),
    )
    expect(existsSync(join(root, 'state/git/index.json'))).toBe(false)
    expect(existsSync(join(root, 'state/metrics/host.json'))).toBe(false)
    expect(existsSync(join(root, 'state/environment/report.json'))).toBe(false)
    // Without --demo nothing example-shaped is started. Example *data* is gone
    // entirely: work lives in a provider now, and Portta creates none of it.
    expect(mocks.demoStacksUp).not.toHaveBeenCalled()
  })

  it('runs no long docker operation on the dev path with its output swallowed', async () => {
    // Anything that builds, pulls or brings containers up is work a person is
    // waiting on, and must reach the terminal: a `docker compose run --build`
    // behind the piped default would sit silent for as long as the build takes.
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await resetCommand({}, command())

    const LONG = new Set(['build', '--build', 'pull', 'up', 'run'])
    const swallowed = mocks.runProcess.mock.calls
      .filter((call) => {
        const args = (call[1] ?? []) as string[]
        const options = call[2] as { stdio?: string } | undefined
        return (
          call[0] === 'docker' && args.some((argument) => LONG.has(argument)) && (options?.stdio ?? 'pipe') === 'pipe'
        )
      })
      .map((call) => `docker ${((call[1] ?? []) as string[]).join(' ')}`)

    // The list, not a count: when this fails the message is the diagnosis.
    expect(swallowed).toEqual([])
  })

  it('treats a missing panel volume as success and applies the demo when asked', async () => {
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.ensureDevDemoOwner.mockResolvedValue('demo-token')
    mocks.waitForPanel.mockResolvedValue(undefined)
    mocks.demoStacksUp.mockResolvedValue(undefined)
    mocks.demoStacksDown.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await resetCommand({ demo: true }, command())

    expect(mocks.demoStacksDown).toHaveBeenCalledTimes(1)
    expect(mocks.waitForPanel).toHaveBeenCalledTimes(1)
    expect(mocks.ensureDevDemoOwner).toHaveBeenCalledTimes(1)
    expect(mocks.finishWebUp).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, 'demo-token')
    expect(mocks.demoStacksUp).toHaveBeenCalledTimes(1)
    expect(mocks.demoStacksUp).toHaveBeenCalledTimes(1)
  })

  it('up --demo applies the demonstration after the gateway is up', async () => {
    checkout()
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.demoStacksUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await upCommand(undefined, { demo: true }, command())

    expect(mocks.syncForwardAuth).toHaveBeenCalledWith(expect.any(String))
    expect(mocks.demoStacksUp).toHaveBeenCalledTimes(1)
    expect(mocks.demoStacksUp).toHaveBeenCalledTimes(1)
    const up = mocks.runProcess.mock.calls.find((call) => ((call[1] ?? []) as string[]).includes('up'))
    expect(up?.[1]).toEqual(expect.arrayContaining(['--wait', '--wait-timeout', '180']))
  })

  it('down --demo stops example stacks before the gateway', async () => {
    checkout()
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    const order: string[] = []
    mocks.demoStacksDown.mockImplementation(async () => {
      order.push('demo')
    })
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('down')) order.push('gateway')
      return ok()
    })

    await downCommand({ demo: true }, command())

    expect(order).toEqual(['demo', 'gateway'])
  })

  it('down without --demo leaves example stacks alone', async () => {
    checkout()
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await downCommand({}, command())

    expect(mocks.demoStacksDown).not.toHaveBeenCalled()
  })

  it('dev --reset is the same wipe', async () => {
    checkout()
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await devCommand(undefined, { reset: true }, command())

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.demoStacksDown).toHaveBeenCalledTimes(1)
  })

  it('reset downs a Portta project with its volumes and leaves unrelated Compose alone', async () => {
    const root = checkout()
    const shopDir = join(root, 'shop')
    mkdirSync(shopDir)
    mocks.confirm.mockResolvedValue(undefined)
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.removeApplier.mockResolvedValue(undefined)
    mocks.removeRunner.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([
      {
        id: 'shop-web',
        name: 'shop-web-1',
        image: 'nginx',
        state: 'running',
        labels: {
          'com.docker.compose.project': 'shop',
          'com.docker.compose.project.working_dir': shopDir,
          'portta.project': 'shop',
        },
        ports: [],
        networks: ['portta'],
      },
      {
        id: 'other-web',
        name: 'other-web-1',
        image: 'nginx',
        state: 'running',
        labels: { 'com.docker.compose.project': 'unrelated' },
        ports: [],
        networks: ['bridge'],
      },
      {
        id: 'bridge',
        name: 'portta-access-shop-mysql',
        image: 'alpine',
        state: 'running',
        labels: { 'portta.managed': 'true', 'portta.component': 'access-bridge' },
        ports: [],
        networks: ['portta-access'],
      },
    ])
    mocks.runProcess.mockResolvedValue(ok())

    await resetCommand({}, command())

    expect(mocks.runProcess).toHaveBeenCalledWith(
      'docker',
      ['compose', '--project-name', 'shop', '--project-directory', shopDir, 'down', '--volumes', '--remove-orphans'],
      { cwd: shopDir, stdio: 'inherit' },
    )
    expect(mocks.runProcess.mock.calls.some(([, args]) => (args as string[]).includes('unrelated'))).toBe(false)
    expect(mocks.runProcess).toHaveBeenCalledWith('docker', ['rm', '-f', 'portta-access-shop-mysql'], { reject: false })
  })

  it('dev creates the owner and migrates, and starts no example stack without --demo', async () => {
    checkout()
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.waitForPanel.mockResolvedValue(undefined)
    mocks.ensureDevDemoOwner.mockResolvedValue('demo-token')
    mocks.demoStacksUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await devCommand(undefined, {}, command())

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.runProcess.mock.calls.some(([, args]) => args[0] === 'volume')).toBe(false)
    expect(mocks.ensureDevDemoOwner).toHaveBeenCalledTimes(1)
    expect(mocks.finishWebUp).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, 'demo-token')
    expect(mocks.demoStacksUp).not.toHaveBeenCalled()
  })

  it('dev --demo creates the owner, then migrates, then starts the example stacks', async () => {
    checkout()
    mocks.requireDocker.mockResolvedValue(undefined)
    mocks.ensureNetwork.mockResolvedValue('created')
    mocks.ensureApplier.mockResolvedValue({ action: 'absent' })
    mocks.ensureRunner.mockResolvedValue({ action: 'absent' })
    mocks.refreshRepositories.mockResolvedValue(undefined)
    mocks.ensureMetricsCollector.mockResolvedValue(undefined)
    mocks.inspectContainers.mockResolvedValue([])
    mocks.prepareWebUp.mockReturnValue({})
    mocks.finishWebUp.mockResolvedValue(undefined)
    mocks.waitForPanel.mockResolvedValue(undefined)
    mocks.ensureDevDemoOwner.mockResolvedValue('demo-token')
    mocks.demoStacksUp.mockResolvedValue(undefined)
    mocks.runProcess.mockResolvedValue(ok())

    await devCommand(undefined, { demo: true }, command())

    expect(mocks.ensureCheckoutCli).toHaveBeenCalledTimes(1)
    expect(mocks.reexecBuiltCli).not.toHaveBeenCalled()
    expect(mocks.waitForPanel).toHaveBeenCalledTimes(1)
    expect(mocks.ensureDevDemoOwner).toHaveBeenCalledTimes(1)
    expect(mocks.finishWebUp).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, 'demo-token')
    expect(mocks.demoStacksUp).toHaveBeenCalledTimes(1)
    const ownerAfterUp = mocks.ensureDevDemoOwner.mock.invocationCallOrder[0]!
    const migrateAfterOwner = mocks.finishWebUp.mock.invocationCallOrder[0]!
    const importAfterMigrate = mocks.demoStacksUp.mock.invocationCallOrder[0]!
    expect(ownerAfterUp).toBeLessThan(migrateAfterOwner)
    expect(migrateAfterOwner).toBeLessThan(importAfterMigrate)
  })

  it('rebuilds a stale CLI and re-runs dev before starting the gateway', async () => {
    checkout()
    mocks.ensureCheckoutCli.mockResolvedValue(true)
    mocks.reexecBuiltCli.mockResolvedValue(undefined)

    await devCommand(undefined, { demo: true }, command())

    expect(mocks.reexecBuiltCli).toHaveBeenCalledTimes(1)
    expect(mocks.requireDocker).not.toHaveBeenCalled()
    expect(mocks.demoStacksUp).not.toHaveBeenCalled()
  })
})

describe('Portta-owned Compose projects', () => {
  const networks = { shared: 'portta', access: 'portta-access' }

  it('owns containers by managed label, project label or shared network', () => {
    expect(isPorttaOwnedContainer({ labels: { 'portta.managed': 'true' }, networks: [] }, networks)).toBe(true)
    expect(isPorttaOwnedContainer({ labels: { 'portta.project': 'shop' }, networks: ['bridge'] }, networks)).toBe(true)
    expect(isPorttaOwnedContainer({ labels: {}, networks: ['portta'] }, networks)).toBe(true)
    expect(isPorttaOwnedContainer({ labels: {}, networks: ['portta-access'] }, networks)).toBe(true)
    expect(isPorttaOwnedContainer({ labels: {}, networks: ['bridge'] }, networks)).toBe(false)
  })

  it('lists consumer projects and skips the gateway and unrelated Compose', () => {
    expect(
      porttaOwnedComposeProjects(
        [
          { labels: { 'com.docker.compose.project': 'portta', 'portta.managed': 'true' }, networks: ['portta'] },
          {
            labels: {
              'com.docker.compose.project': 'shop',
              'com.docker.compose.project.working_dir': '/srv/shop',
              'portta.project': 'shop',
            },
            networks: ['portta'],
          },
          { labels: { 'com.docker.compose.project': 'unrelated' }, networks: ['bridge'] },
        ],
        { gatewayProject: 'portta', sharedNetwork: 'portta', accessNetwork: 'portta-access' },
      ),
    ).toEqual([{ name: 'shop', workingDir: '/srv/shop' }])
  })
})
