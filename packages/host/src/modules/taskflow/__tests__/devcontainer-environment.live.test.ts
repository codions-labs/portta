import { access, cp, mkdtemp, rm } from 'node:fs/promises'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { EnvironmentRecord, EnvironmentService, ServicePort } from 'portta-core/taskflow'
import { afterAll, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DevContainerProvider } from '../adapters/devcontainer-environment.ts'
import { NodeProcessRunner } from '../adapters/process-runner.ts'
import { applyEnvironmentResourcePolicy } from '../services/environment-resource-policy.ts'
import { DockerServiceDiscoverySource } from '../services/environment-service-discovery.ts'
import { LocalForwardProvider } from '../services/local-forward-provider.ts'

const live = process.env.PORTTA_FLOW_LIVE_DOCKER === '1'
const roots: string[] = []
const forwards = new LocalForwardProvider()

function record(handle: Awaited<ReturnType<DevContainerProvider['start']>>): EnvironmentRecord {
  const now = new Date().toISOString()
  return {
    ...handle,
    desiredStatus: 'ready',
    configRef: '.devcontainer/devcontainer.json',
    configHash: 'live',
    capabilities: {
      exec: true,
      stdin: true,
      pty: true,
      resize: false,
      signals: true,
      reattach: false,
      services: true,
      rebuild: true,
    },
    security: {
      trusted: true,
      reasons: [],
      initializeCommand: false,
      privileged: false,
      dockerSocket: false,
      devices: false,
      broadMounts: false,
      features: [],
      unpinnedFeatures: [],
      addedCapabilities: [],
      securityOptions: [],
      secretKeys: [],
      isolationRisks: [],
    },
    error: null,
    createdAt: now,
    updatedAt: now,
  }
}

function service(services: EnvironmentService[], name: string): EnvironmentService {
  const found = services.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`Missing service: ${name}`)
  return found
}

function port(candidate: EnvironmentService, number: number): ServicePort {
  const found = candidate.ports.find((item) => item.containerPort === number)
  if (!found) throw new Error(`Missing port ${number} for ${candidate.name}`)
  return found
}

async function postgresHandshake(url: string): Promise<string> {
  const target = new URL(url.replace('tcp:', 'http:'))
  return new Promise((resolveMessage, reject) => {
    const socket = connect(Number(target.port), target.hostname, () => {
      const request = Buffer.alloc(8)
      request.writeInt32BE(8, 0)
      request.writeInt32BE(80877103, 4)
      socket.write(request)
    })
    socket.once('data', (data) => {
      resolveMessage(data.toString('utf8'))
      socket.destroy()
    })
    socket.once('error', reject)
  })
}

async function websocketMessage(url: string): Promise<string> {
  return new Promise((resolveMessage, reject) => {
    const socket = new WebSocket(url.replace('http:', 'ws:'))
    socket.once('open', () => socket.send('ping'))
    socket.once('message', (message) => {
      resolveMessage(message.toString())
      socket.close()
    })
    socket.once('error', reject)
  })
}

describe.runIf(live)('Dev Container environment (live)', () => {
  afterAll(async () => {
    await forwards.close()
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('isolates two projects, proxies HTTP/WS/SSE and forwards two PostgreSQL sidecars', async () => {
    const fixture = resolve(import.meta.dirname, '../../../../../../tests/fixtures/taskflow/devcontainer-environment')
    const root = await mkdtemp(join(tmpdir(), 'taskflow-devcontainer-live-'))
    roots.push(root)
    const workspaces = [join(root, 'project-a'), join(root, 'project-b')]
    await Promise.all(workspaces.map((workspace) => cp(fixture, workspace, { recursive: true })))
    const provider = new DevContainerProvider()
    const handles = []
    try {
      for (let index = 0; index < workspaces.length; index += 1) {
        const workspacePath = workspaces[index]
        if (!workspacePath) throw new Error('Missing live workspace')
        const scope = {
          installationId: 'issue-10-live',
          projectId: `project-${index}`,
          workspaceId: `workspace-${index}`,
        }
        const resolved = await provider.resolve({ workspacePath, projectPath: workspacePath, scope })
        handles.push(
          await applyEnvironmentResourcePolicy(new NodeProcessRunner(), await provider.start(resolved, scope)),
        )
      }
      expect(handles[0]?.id).not.toBe(handles[1]?.id)
      const discovery = new DockerServiceDiscoverySource()
      const catalogs = await Promise.all(handles.map((handle) => discovery.discover(record(handle))))
      for (const catalog of catalogs) {
        expect(catalog.map((item) => item.name).sort()).toEqual(['backend', 'frontend', 'postgres'])
      }
      const httpEndpoints = []
      const postgresEndpoints = []
      for (let index = 0; index < handles.length; index += 1) {
        const handle = handles[index]
        const catalog = catalogs[index]
        if (!handle || !catalog) throw new Error('Missing live environment')
        const backend = service(catalog, 'backend')
        const postgres = service(catalog, 'postgres')
        httpEndpoints.push(
          await forwards.publish({
            endpointId: `http-${handle.id}`,
            serviceId: backend.id,
            targetHost: '127.0.0.1',
            port: port(backend, 8080),
            environment: handle,
            transport: provider,
          }),
        )
        postgresEndpoints.push(
          await forwards.publish({
            endpointId: `postgres-${handle.id}`,
            serviceId: postgres.id,
            targetHost: 'postgres',
            port: port(postgres, 5432),
            environment: handle,
            transport: provider,
          }),
        )
      }
      expect(httpEndpoints[0]?.url).not.toBe(httpEndpoints[1]?.url)
      expect(postgresEndpoints[0]?.url).not.toBe(postgresEndpoints[1]?.url)
      for (const endpoint of httpEndpoints) {
        expect((await fetch(`${endpoint.url}/health`)).status).toBe(200)
        expect(await (await fetch(`${endpoint.url}/events`)).text()).toContain('data: backend')
        expect(await websocketMessage(endpoint.url)).toBe('ready')
      }
      for (const endpoint of postgresEndpoints) expect(await postgresHandshake(endpoint.url)).toBe('N')
      const first = handles[0]
      const secondEndpoint = httpEndpoints[1]
      if (!first || !secondEndpoint) throw new Error('Missing teardown target')
      const markerName = 'cancelled-command-survived'
      const cancelledMarker = join(first.workspace.hostPath, markerName)
      const containerMarker = join(first.workspace.containerPath ?? first.workspace.hostPath, markerName)
      const abort = new AbortController()
      const cancelled = provider.spawn(first, {
        argv: [
          'node',
          '-e',
          `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(containerMarker)}, "survived"), 500)`,
        ],
        cwd: 'workspace',
        signal: abort.signal,
      })
      await sleep(50)
      abort.abort()
      await cancelled.exited
      await sleep(700)
      await expect(access(cancelledMarker)).rejects.toThrow()
      await provider.destroy(first)
      await provider.destroy(first)
      expect((await fetch(`${secondEndpoint.url}/health`)).status).toBe(200)
    } finally {
      await Promise.all(handles.map((handle) => provider.destroy(handle)))
    }
  }, 300_000)
})
