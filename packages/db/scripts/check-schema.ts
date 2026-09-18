// Generate in a disposable package: even a failed check must leave the SQL,
// journal and snapshots in the checkout untouched.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), 'portta-schema-check-'))
const require = createRequire(import.meta.url)

function inventory(directory: string): string {
  return JSON.stringify(
    readdirSync(directory, { recursive: true })
      .map(String)
      .sort()
      .filter((name) => /\.(sql|json)$/.test(name))
      .map((name) => [name, readFileSync(join(directory, name), 'utf8')]),
  )
}

try {
  for (const name of ['src', 'drizzle', 'drizzle.config.ts', 'package.json']) {
    cpSync(join(packageRoot, name), join(temporary, name), { recursive: true })
  }
  symlinkSync(resolve(packageRoot, '../../node_modules'), join(temporary, 'node_modules'), 'dir')
  const before = inventory(join(temporary, 'drizzle'))
  const cli = join(dirname(require.resolve('drizzle-kit')), 'bin.cjs')
  for (const command of ['check', 'generate']) {
    execFileSync(process.execPath, ['--conditions=development', cli, command], {
      cwd: temporary,
      stdio: 'inherit',
      env: { ...process.env, NODE_OPTIONS: '--conditions=development' },
    })
  }
  if (inventory(join(temporary, 'drizzle')) !== before) {
    throw new Error(
      'Schema and migrations differ. Run npm run db:generate --workspace=portta-db and review the migration.',
    )
  }
  console.log('schema and migrations agree (checkout unchanged)')
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
