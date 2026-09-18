import { afterEach, describe, expect, it, vi } from 'vitest'
import { DOCKER_ENGINE_API_VERSION, DockerApiError, DockerClient, demultiplex } from '../src/services/docker/client.ts'

function frame(stream: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const header = Buffer.alloc(8)
  header[0] = stream
  header.writeUInt32BE(payload.length, 4)
  return Buffer.concat([header, payload])
}

describe('log demultiplexing', () => {
  it('splits Docker frames into stdout and stderr lines', () => {
    const buffer = Buffer.concat([
      frame(1, '2026-01-01T00:00:01Z first\n2026-01-01T00:00:02Z second\n'),
      frame(2, '2026-01-01T00:00:03Z oh no\n'),
    ])
    const lines = demultiplex(buffer)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toEqual({ stream: 'stdout', timestamp: '2026-01-01T00:00:01Z', text: 'first' })
    expect(lines[2]).toEqual({ stream: 'stderr', timestamp: '2026-01-01T00:00:03Z', text: 'oh no' })
  })

  it('keeps a line that carries no timestamp', () => {
    const lines = demultiplex(frame(1, 'plain output\n'))
    expect(lines[0]).toEqual({ stream: 'stdout', timestamp: null, text: 'plain output' })
  })

  it('strips the colour codes runtimes emit even without a TTY', () => {
    const lines = demultiplex(frame(1, '2026-01-01T00:00:01Z \u001b[90m2026\u001b[0m \u001b[32mINF\u001b[0m ready\n'))
    expect(lines[0]?.text).toBe('2026 INF ready')
  })

  it('does not loop forever on an empty frame', () => {
    const lines = demultiplex(Buffer.concat([frame(1, ''), frame(1, 'after\n')]))
    expect(lines.map((line) => line.text)).toContain('after')
  })
})

describe('the client refuses to widen its own permissions', () => {
  const fetchMock = vi.fn()

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  function stub(response: Partial<Response> = {}) {
    vi.stubGlobal(
      'fetch',
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        json: async () => ({}),
        text: async () => '{}',
        arrayBuffer: async () => new ArrayBuffer(0),
        ...response,
      } as Response),
    )
  }

  it('removes a container without its volumes or links', async () => {
    stub()
    const client = new DockerClient('http://proxy:2375')
    await client.remove('abc123')
    const url = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(url.pathname).toBe(`/${DOCKER_ENGINE_API_VERSION}/containers/abc123`)
    expect(url.searchParams.get('v')).toBe('0')
    expect(url.searchParams.get('link')).toBe('0')
    expect(url.searchParams.get('force')).toBe('0')
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('never issues a call the allowlist does not name', async () => {
    stub()
    const client = new DockerClient('http://proxy:2375')
    // @ts-expect-error reaching past the public surface on purpose
    await expect(client.request('POST', '/containers/prune')).rejects.toThrow(/does not allow/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('turns an unreachable proxy into a 503, not a stack trace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const client = new DockerClient('http://proxy:2375')
    await expect(client.info()).rejects.toBeInstanceOf(DockerApiError)
    await expect(client.info()).rejects.toThrow(/cannot reach the Docker socket proxy/)
  })

  it('surfaces Docker’s own error message', async () => {
    stub({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      text: async () => JSON.stringify({ message: 'container already stopped' }),
    })
    const client = new DockerClient('http://proxy:2375')
    await expect(client.stop('abc')).rejects.toThrow(/container already stopped/)
  })

  it('creates a bridge with no host access whatsoever', async () => {
    stub({ json: async () => ({ Id: 'new-bridge' }) })
    const client = new DockerClient('http://proxy:2375')
    await client.createBridge({
      name: 'portta-access-alpha-postgres-abc123',
      image: 'alpine/socat:1.8.1.3',
      network: 'alpha_default',
      targetService: 'postgres',
      targetPort: 5432,
      bindIp: '127.0.0.1',
      hostPort: null,
      labels: { 'portta.managed': 'true' },
      ttlSeconds: null,
    })

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.HostConfig.Binds).toEqual([])
    expect(body.HostConfig.Mounts).toEqual([])
    expect(body.HostConfig.Privileged).toBe(false)
    expect(body.HostConfig.CapAdd).toEqual([])
    expect(body.HostConfig.PortBindings['5432/tcp'][0].HostIp).toBe('127.0.0.1')
    expect(body.NetworkingConfig.EndpointsConfig).toHaveProperty('alpha_default')
    expect(body.Cmd).toEqual(['TCP-LISTEN:5432,fork,reuseaddr', 'TCP:postgres:5432'])
  })

  it('wraps the command in a timeout when a TTL is asked for', async () => {
    stub({ json: async () => ({ Id: 'new-bridge' }) })
    const client = new DockerClient('http://proxy:2375')
    await client.createBridge({
      name: 'portta-access-alpha-redis-abc123',
      image: 'alpine/socat:1.8.1.3',
      network: 'alpha_default',
      targetService: 'redis',
      targetPort: 6379,
      bindIp: '127.0.0.1',
      hostPort: null,
      labels: {},
      ttlSeconds: 1800,
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body.Entrypoint).toEqual(['sh'])
    expect(body.Cmd[1]).toContain('timeout -s TERM 1800')
  })
})
