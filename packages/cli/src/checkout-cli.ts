import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Output } from './output.js'
import { runProcess } from './process.js'

/** Trees bundled into `packages/cli/dist/cli.js`. A newer file here means dist is stale. */
export const CHECKOUT_CLI_SOURCES = [
  'packages/cli/src',
  'packages/cli/scripts',
  'packages/cli/package.json',
  'packages/core/src',
  'packages/contracts/src',
  'packages/host/src',
] as const

export function checkoutCliDist(root: string): string {
  return join(root, 'packages/cli/dist/cli.js')
}

export function isCheckout(root: string): boolean {
  return existsSync(join(root, 'packages/cli/src/cli.ts')) && existsSync(join(root, 'package.json'))
}

function newestSourceMtime(path: string): number {
  if (!existsSync(path)) return 0
  const info = statSync(path)
  if (info.isFile()) return /\.(ts|mjs|json)$/.test(path) ? info.mtimeMs : 0
  let newest = 0
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    newest = Math.max(newest, newestSourceMtime(join(path, entry.name)))
  }
  return newest
}

export function checkoutCliNeedsBuild(root: string): boolean {
  if (!isCheckout(root)) return false
  const dist = checkoutCliDist(root)
  if (!existsSync(dist)) return true
  const distTime = statSync(dist).mtimeMs
  return CHECKOUT_CLI_SOURCES.some((tree) => newestSourceMtime(join(root, tree)) > distTime)
}

/** Rebuild dist when the checkout sources are newer. Returns whether dist was built. */
export async function ensureCheckoutCli(root: string, output: Output): Promise<boolean> {
  if (!checkoutCliNeedsBuild(root)) return false
  output.progress('building the TypeScript CLI')
  await runProcess('npm', ['run', 'build', '--workspace=@codions/portta'], { cwd: root, stdio: 'inherit' })
  return true
}

export async function reexecBuiltCli(root: string): Promise<void> {
  const result = await runProcess(process.execPath, [checkoutCliDist(root), ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    reject: false,
  })
  process.exit(result.exitCode)
}
