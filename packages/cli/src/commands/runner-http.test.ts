import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { type ContainerRecord, httpAccessOperationPath, httpAccessOverlayPath } from 'portta-core'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runProcess: vi.fn(), containers: [] as ContainerRecord[] }))
vi.mock('../process.js', () => ({ runProcess: (...args: unknown[]) => mocks.runProcess(...args) }))
vi.mock('../docker.js', () => ({ inspectContainers: async () => mocks.containers }))

import { integrateHttpFromRunner, projectHttpOverlayFromRunner, refreshHttpAccessOverlay } from './runner-http.js'

const temporary: string[] = []
afterEach(() => {
  mocks.runProcess.mockReset()
  mocks.containers = []
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})
const request = {
  verb: 'integrate-http',
  project: 'shop',
  service: 'mailpit',
  port: 8025,
  requestId: '68da322b-3b78-4ce7-9be2-bcaf206f23b9',
}
const ok = (value = '') => ({ stdout: value, stderr: '', exitCode: 0, failed: false })
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'portta-http-runner-')))
  temporary.push(root)
  const workspace = join(root, 'shop')
  const gateway = join(root, 'gateway')
  const file = join(workspace, 'compose.yaml')
  mkdirSync(workspace)
  mkdirSync(join(gateway, 'state/runner'), { recursive: true })
  writeFileSync(file, 'services: {}\n')
  writeFileSync(join(gateway, 'state/runner/request.json'), JSON.stringify(request))
  writeFileSync(
    join(gateway, 'state/runner/http-access.json'),
    JSON.stringify({ version: 1, attachments: [{ project: 'shop', service: 'mailpit' }] }),
  )
  const context = {
    root: gateway,
    env: { PORTTA_RUNNER: 'true' },
    config: { projectName: 'portta', network: 'portta' },
  } as never
  mocks.containers = [
    {
      id: 'mailpit-id',
      name: 'shop-mailpit-1',
      image: 'axllent/mailpit:latest',
      state: 'running',
      health: null,
      labels: {
        'com.docker.compose.project': 'shop',
        'com.docker.compose.service': 'mailpit',
        'com.docker.compose.project.working_dir': workspace,
        'com.docker.compose.project.config_files': file,
      },
      ports: [
        { ip: '', privatePort: 1025, publicPort: null, type: 'tcp' },
        { ip: '', privatePort: 8025, publicPort: null, type: 'tcp' },
      ],
      networks: ['shop_default'],
    },
  ]
  const model = {
    services: {
      app: { labels: { 'traefik.enable': 'true' }, networks: { backend: {}, portta: {} } },
      mailpit: { networks: { backend: { aliases: ['mail'], ipv4_address: '172.24.0.4' } } },
    },
    networks: { backend: { name: 'shop_backend' } },
  }
  mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
    if (args.includes('up')) mocks.containers[0]!.networks.push('portta')
    return ok(args.includes('--format') ? JSON.stringify(model) : '')
  })
  return { root: gateway, workspace, file, context, model }
}

describe('HTTP service integration runner', () => {
  it('preserves private network options and recreates only the selected service without publishing or adding an automatic router', async () => {
    const { context, root, file } = fixture()
    await integrateHttpFromRunner(context, '/')
    const overlay = httpAccessOverlayPath(root, 'shop')
    const content = readFileSync(overlay, 'utf8')
    expect(content).toContain('"backend":{"aliases":["mail"],"ipv4_address":"172.24.0.4"}')
    expect(content).toContain('ports: !reset []')
    expect(content).toContain('traefik.enable: "false"')
    expect(content).not.toContain('app:')
    const calls = mocks.runProcess.mock.calls.filter(([, args]) => args.includes('up'))
    expect(calls).toHaveLength(1)
    expect(calls[0]![1]).toEqual([
      'compose',
      '-p',
      'shop',
      '--project-directory',
      dirname(file),
      '-f',
      file,
      '-f',
      overlay,
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      '--no-build',
      '--pull',
      'never',
      'mailpit',
    ])
    expect(JSON.parse(readFileSync(httpAccessOperationPath(root, request.requestId), 'utf8'))).toEqual({
      ...request,
      verb: undefined,
      state: 'ok',
      error: null,
    })
    expect(readFileSync(file, 'utf8')).toBe('services: {}\n')
  })

  it('requires API-owned intent and refuses a raw SMTP port before Compose can recreate anything', async () => {
    const { context, root } = fixture()
    writeFileSync(join(root, 'state/runner/http-access.json'), '{"version":1,"attachments":[]}')
    await expect(integrateHttpFromRunner(context, '/')).rejects.toThrow('not authorized')
    expect(mocks.runProcess).not.toHaveBeenCalled()
    writeFileSync(
      join(root, 'state/runner/http-access.json'),
      JSON.stringify({ version: 1, attachments: [{ project: 'shop', service: 'mailpit' }] }),
    )
    writeFileSync(join(root, 'state/runner/request.json'), JSON.stringify({ ...request, port: 1025 }))
    await expect(integrateHttpFromRunner(context, '/')).rejects.toThrow('does not serve HTTP')
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })

  it('accepts an explicit HTTP backend label when an application image exposes a different runtime port', async () => {
    const { context, root } = fixture()
    mocks.containers[0]!.image = 'php:8.4'
    mocks.containers[0]!.ports = [{ ip: '', privatePort: 9000, publicPort: null, type: 'tcp' }]
    mocks.containers[0]!.labels['traefik.http.services.shop-app.loadbalancer.server.port'] = '8000'
    writeFileSync(join(root, 'state/runner/request.json'), JSON.stringify({ ...request, port: 8000 }))
    await integrateHttpFromRunner(context, '/')
    expect(JSON.parse(readFileSync(httpAccessOperationPath(root, request.requestId), 'utf8')).state).toBe('ok')
  })

  it('restores the previous projection and attempts recovery only for the selected service if recreation fails', async () => {
    const { context, root, model } = fixture()
    const overlay = httpAccessOverlayPath(root, 'shop')
    mkdirSync(dirname(overlay), { recursive: true })
    writeFileSync(overlay, '# previous attachment\n')
    let up = 0
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('up') && up++ === 0) return { ...ok(), exitCode: 1, stderr: 'cannot start target' }
      return ok(args.includes('--format') ? JSON.stringify(model) : '')
    })
    await expect(integrateHttpFromRunner(context, '/')).rejects.toThrow('could not be recreated')
    expect(readFileSync(overlay, 'utf8')).toBe('# previous attachment\n')
    const calls = mocks.runProcess.mock.calls.filter(([, args]) => args.includes('up'))
    expect(calls).toHaveLength(2)
    expect(
      calls.every(([, args]) => args.at(-1) === 'mailpit' && args.includes('--no-deps') && args.includes('--no-build')),
    ).toBe(true)
    expect(JSON.parse(readFileSync(httpAccessOperationPath(root, request.requestId), 'utf8')).state).toBe('failed')
  })

  it('regenerates future runner attachments from source, excluding its own previous projection and preserving existing HTTP labels', async () => {
    const { context, root, model, file } = fixture()
    const overlay = httpAccessOverlayPath(root, 'shop')
    mocks.containers[0]!.labels['com.docker.compose.project.config_files'] = `${file},${overlay}`
    model.services.mailpit = {
      ...model.services.mailpit,
      labels: { 'traefik.enable': 'true' },
    } as typeof model.services.mailpit
    writeFileSync(join(root, 'state/runner/request.json'), JSON.stringify({ verb: 'restart', project: 'shop' }))
    await projectHttpOverlayFromRunner(context, '/')
    const input = mocks.runProcess.mock.calls[0]![1] as string[]
    expect(input).not.toContain(overlay)
    expect(readFileSync(overlay, 'utf8')).not.toContain('traefik.enable')
  })

  it('does not resurrect a service removed from Compose and removes an obsolete generated projection', async () => {
    const { context, root, workspace, file } = fixture()
    mocks.runProcess.mockResolvedValue(ok('{"services":{"app":{}}}'))
    const overlay = httpAccessOverlayPath(root, 'shop')
    mkdirSync(dirname(overlay), { recursive: true })
    writeFileSync(overlay, '# obsolete\n')
    expect(
      await refreshHttpAccessOverlay(context, { project: 'shop', workingDir: workspace, files: [file] }),
    ).toBeNull()
    expect(existsSync(overlay)).toBe(false)
  })

  it('refuses source or inherited ungated routers before attaching a service on a public host', async () => {
    const { root, workspace, file, model } = fixture()
    const context = { root, env: {}, config: { network: 'portta', profile: 'remote-public' } } as never
    Object.assign(model.services.mailpit, { labels: { 'traefik.enable': 'true' } })
    await expect(
      refreshHttpAccessOverlay(context, { project: 'shop', workingDir: workspace, files: [file] }),
    ).rejects.toThrow('ungated router')
    expect(existsSync(httpAccessOverlayPath(root, 'shop'))).toBe(false)
    Object.assign(model.services.mailpit, {
      labels: { 'traefik.enable': 'true', 'traefik.http.routers.mailpit.middlewares': 'portta-forward-auth@file' },
    })
    mocks.containers[0]!.labels['traefik.http.routers.inherited.rule'] = 'Host(`unprotected.example.test`)'
    await expect(
      refreshHttpAccessOverlay(context, { project: 'shop', workingDir: workspace, files: [file] }),
    ).rejects.toThrow('ungated router')
  })

  it('never starts a recreated public service whose changed image contributes a hidden ungated router', async () => {
    const { root, model } = fixture()
    const context = {
      root,
      env: {
        PORTTA_RUNNER: 'true',
        PORTTA_PROFILE: 'remote-public',
        PORTTA_RUNNER_PUBLIC: 'true',
        PORTTA_WEB_EXPOSE: 'domain',
        PORTTA_AUTH_MODE: 'required',
        TLS_ENABLED: 'true',
      },
      config: { network: 'portta', profile: 'remote-public', projectName: 'portta' },
    } as never
    const gate = { 'traefik.enable': 'true', 'traefik.http.routers.mailpit.middlewares': 'portta-forward-auth@file' }
    Object.assign(model.services.mailpit, { labels: gate })
    Object.assign(mocks.containers[0]!.labels, gate)
    mocks.runProcess.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes('up')) {
        mocks.containers[0]!.state = 'created'
        mocks.containers[0]!.labels['traefik.http.routers.hidden.rule'] = 'Host(`unprotected.example.test`)'
      }
      return ok(args.includes('--format') ? JSON.stringify(model) : '')
    })
    await expect(integrateHttpFromRunner(context, '/')).rejects.toThrow('ungated router')
    const changes = mocks.runProcess.mock.calls.filter(([, args]) => args.includes('up') || args.includes('start'))
    expect(changes).toHaveLength(2)
    expect(changes.every(([, args]) => args.includes('--no-start') && args.at(-1) === 'mailpit')).toBe(true)
    expect(mocks.containers[0]!.state).toBe('created')
  })

  it('reuses a gateway network already declared by source instead of adding a second physical attachment', async () => {
    const { context, root, workspace, file, model } = fixture()
    Object.assign(model.networks, { existing_gateway: { name: 'portta', external: true } })
    Object.assign(model.services.mailpit.networks, { existing_gateway: { aliases: ['mailpit-gateway'] } })
    await refreshHttpAccessOverlay(context, { project: 'shop', workingDir: workspace, files: [file] })
    const content = readFileSync(httpAccessOverlayPath(root, 'shop'), 'utf8')
    expect(content).toContain('"existing_gateway":{"aliases":["mailpit-gateway"]}')
    expect(content).not.toContain('portta_http_access')
  })
})
