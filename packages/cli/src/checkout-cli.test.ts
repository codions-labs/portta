import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkoutCliDist, checkoutCliNeedsBuild, ensureCheckoutCli, isCheckout } from './checkout-cli.js'

const mocks = vi.hoisted(() => ({ runProcess: vi.fn() }))
vi.mock('./process.js', () => ({ runProcess: mocks.runProcess }))

describe('checkout CLI dest', () => {
  const roots: string[] = []
  afterEach(() => {
    mocks.runProcess.mockReset()
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function checkout(options: { dest?: boolean; destAge?: number } = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'portta-cli-build-'))
    roots.push(root)
    mkdirSync(join(root, 'packages/cli/src'), { recursive: true })
    writeFileSync(join(root, 'package.json'), '{}')
    writeFileSync(join(root, 'packages/cli/src/cli.ts'), 'export {}\n')
    if (options.dest) {
      mkdirSync(join(root, 'packages/cli/dist'), { recursive: true })
      const dest = checkoutCliDist(root)
      writeFileSync(dest, '#!/usr/bin/env node\n')
      if (options.destAge !== undefined) {
        const past = (Date.now() - options.destAge) / 1000
        utimesSync(dest, past, past)
      }
    }
    return root
  }

  it('is only a checkout when the TypeScript CLI sources are present', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-cli-build-'))
    roots.push(root)
    writeFileSync(join(root, 'package.json'), '{}')
    expect(isCheckout(root)).toBe(false)
    expect(checkoutCliNeedsBuild(root)).toBe(false)
  })

  it('needs a build when dest is missing', () => {
    expect(checkoutCliNeedsBuild(checkout())).toBe(true)
  })

  it('needs a build when a source file is newer than dest', () => {
    const root = checkout({ dest: true, destAge: 60_000 })
    expect(checkoutCliNeedsBuild(root)).toBe(true)
  })

  it('is current when dest is newer than the sources', () => {
    const root = checkout({ dest: true })
    const past = (Date.now() - 60_000) / 1000
    utimesSync(join(root, 'packages/cli/src/cli.ts'), past, past)
    expect(checkoutCliNeedsBuild(root)).toBe(false)
  })

  it('does not spawn npm when dest is already current', async () => {
    const root = checkout({ dest: true })
    const past = (Date.now() - 60_000) / 1000
    utimesSync(join(root, 'packages/cli/src/cli.ts'), past, past)
    await expect(ensureCheckoutCli(root, { progress: vi.fn() } as never)).resolves.toBe(false)
    expect(mocks.runProcess).not.toHaveBeenCalled()
  })
})
