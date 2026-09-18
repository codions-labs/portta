import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GatewayContext } from './context.ts'

const runProcess = vi.hoisted(() => vi.fn())
vi.mock('./process.js', () => ({ runProcess }))

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireLocalRelease, selectLocalRelease } from './local-release.ts'

const context = {
  root: '/work/portta',
  version: '0.8.0',
  env: { PORTTA_LOCAL_RELEASE: 'true' },
  config: {} as GatewayContext['config'],
  composeFiles: [],
} satisfies GatewayContext

describe('local release preflight', () => {
  beforeEach(() => runProcess.mockReset())

  it('names every missing image and points to just build', async () => {
    runProcess
      .mockResolvedValueOnce({ exitCode: 0 })
      .mockResolvedValueOnce({ exitCode: 1 })
      .mockResolvedValueOnce({ exitCode: 1 })
    await expect(requireLocalRelease(context)).rejects.toMatchObject({
      message: expect.stringContaining('portta-apply:0.8.0'),
      hint: 'run just build',
    })
  })

  it('does nothing outside a Just local-release invocation', async () => {
    await requireLocalRelease({ ...context, env: {} })
    expect(runProcess).not.toHaveBeenCalled()
  })
})

it('local-release selection consumes the built runtime and disables dev/build overlays', () => {
  const root = mkdtempSync(join(tmpdir(), 'portta-local-release-'))
  try {
    writeFileSync(join(root, '.env'), 'PORTTA_WEB_BUILD=true\nPORTTA_WEB_DEV=true\n')
    selectLocalRelease({ ...context, root })
    const env = readFileSync(join(root, '.env'), 'utf8')
    expect(env).toContain('PORTTA_WEB_BUILD=false')
    expect(env).toContain('PORTTA_WEB_DEV=false')
    expect(env).toContain('PORTTA_AUTH_IMAGE=codions-labs/portta:0.8.0')
    expect(env).toContain('PORTTA_WEB_IMAGE=codions-labs/portta:0.8.0')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
