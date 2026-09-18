import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export function preparePublication(root, version) {
  if (!SEMVER.test(version ?? '')) throw new Error(`invalid publication version: ${version}`)
  const manifestPath = resolve(root, 'packages/cli/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.version = version
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(resolve(root, 'VERSION'), `${version}\n`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version] = process.argv.slice(2)
  if (!version || process.argv.length !== 3) throw new Error('usage: prepare-publication.mjs VERSION')
  preparePublication(resolve(import.meta.dirname, '..'), version)
}
