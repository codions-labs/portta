import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { root } from '../lib/execution.mjs'

test('schema drift fails without changing checked-in SQL or metadata', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'portta-schema-regression-'))
  const packageRoot = join(temporary, 'packages/db')
  const inventory = () =>
    readdirSync(join(packageRoot, 'drizzle'), { recursive: true })
      .map(String)
      .sort()
      .filter((name) => /\.(sql|json)$/.test(name))
      .map((name) => [name, readFileSync(join(packageRoot, 'drizzle', name), 'utf8')])
  try {
    mkdirSync(packageRoot, { recursive: true })
    for (const entry of ['src', 'scripts', 'drizzle', 'drizzle.config.ts', 'package.json'])
      cpSync(join(root, 'packages/db', entry), join(packageRoot, entry), { recursive: true })
    symlinkSync(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir')
    const path = join(packageRoot, 'src/schema/instance.ts')
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace(
        "name: text('name')",
        "auditProbe: text('audit_probe'),\n    name: text('name')",
      ),
    )
    const before = inventory()
    const result = spawnSync(process.execPath, ['--conditions=development', 'scripts/check-schema.ts'], {
      cwd: packageRoot,
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Schema and migrations differ/)
    assert.deepEqual(inventory(), before)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
})
