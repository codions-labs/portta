import { BRIDGE_IMAGE, loadGatewayConfig } from 'portta-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayContext } from './context.js'
import { PreconditionError } from './errors.js'
import type { ProcessResult } from './process.js'

const runProcess = vi.hoisted(() => vi.fn())
vi.mock('./process.js', () => ({ runProcess }))

import { ensurePanelBridgeImage } from './bridge-image.js'

function context(enabled = true): Pick<GatewayContext, 'config' | 'env'> {
  const env = { PORTTA_WEB: String(enabled), DOCKER_HOST: 'unix:///run/test-docker.sock' }
  return { config: loadGatewayConfig(env), env }
}

const ok: ProcessResult = { stdout: '', stderr: '', exitCode: 0, failed: false }
const absent: ProcessResult = { stdout: '', stderr: `No such image: ${BRIDGE_IMAGE}`, exitCode: 1, failed: true }

describe('the panel access bridge image', () => {
  const output = { progress: vi.fn() }

  beforeEach(() => {
    runProcess.mockReset()
    output.progress.mockReset()
  })

  it('uses a cached image without contacting the registry', async () => {
    const host = context()
    runProcess.mockResolvedValueOnce(ok)

    await ensurePanelBridgeImage(host, output)

    expect(runProcess).toHaveBeenCalledExactlyOnceWith('docker', ['image', 'inspect', BRIDGE_IMAGE], {
      env: host.env,
      reject: false,
    })
    expect(output.progress).not.toHaveBeenCalled()
  })

  it('pulls an absent image on the selected daemon and verifies it before returning', async () => {
    const host = context()
    runProcess.mockResolvedValueOnce(absent).mockResolvedValueOnce(ok).mockResolvedValueOnce(ok)

    await ensurePanelBridgeImage(host, output)

    expect(output.progress).toHaveBeenCalledWith(expect.stringContaining(BRIDGE_IMAGE))
    expect(runProcess.mock.calls).toEqual([
      ['docker', ['image', 'inspect', BRIDGE_IMAGE], { env: host.env, reject: false }],
      ['docker', ['pull', BRIDGE_IMAGE], { env: host.env, reject: false, stdio: 'stream' }],
      ['docker', ['image', 'inspect', BRIDGE_IMAGE], { env: host.env, reject: false }],
    ])
  })

  it('preserves the Docker cause when a pull fails', async () => {
    runProcess.mockResolvedValueOnce(absent).mockResolvedValueOnce({ ...absent, stderr: 'registry: too many requests' })

    const failure = await ensurePanelBridgeImage(context(), output).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(PreconditionError)
    expect(failure).toMatchObject({
      message: expect.stringContaining('registry: too many requests'),
      hint: `run on the Docker host: docker pull ${BRIDGE_IMAGE}`,
    })
    expect(runProcess).toHaveBeenCalledTimes(2)
  })

  it('refuses success when the image cannot be inspected after pulling', async () => {
    runProcess
      .mockResolvedValueOnce(absent)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...absent, stderr: 'Docker daemon disconnected' })

    await expect(ensurePanelBridgeImage(context(), output)).rejects.toMatchObject({
      message: expect.stringContaining('Docker daemon disconnected'),
      hint: `run on the Docker host: docker pull ${BRIDGE_IMAGE}`,
    })
  })

  it('does nothing when the panel is disabled', async () => {
    await ensurePanelBridgeImage(context(false), output)

    expect(runProcess).not.toHaveBeenCalled()
    expect(output.progress).not.toHaveBeenCalled()
  })

  it('accepts a cached image when pulling is disabled', async () => {
    runProcess.mockResolvedValueOnce(ok)

    await ensurePanelBridgeImage(context(), output, { allowPull: false })

    expect(runProcess).toHaveBeenCalledTimes(1)
    expect(runProcess.mock.calls[0]?.[1]).toEqual(['image', 'inspect', BRIDGE_IMAGE])
  })

  it('reports an absent image without pulling when pulling is disabled', async () => {
    runProcess.mockResolvedValueOnce(absent)

    await expect(ensurePanelBridgeImage(context(), output, { allowPull: false })).rejects.toMatchObject({
      message: expect.stringContaining('image pulling is disabled'),
      hint: `run on the Docker host: docker pull ${BRIDGE_IMAGE}`,
    })
    expect(runProcess).toHaveBeenCalledTimes(1)
    expect(output.progress).not.toHaveBeenCalled()
  })
})
