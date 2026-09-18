import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROJECT_CONFIG_DEFAULTS } from 'portta-core'
import { describe, expect, it } from 'vitest'
import { readDeclaredProjectConfig } from '../services/declared-project.ts'

describe('readDeclaredProjectConfig', () => {
  it('reads the branch pattern the project declared', () => {
    const root = mkdtempSync(join(tmpdir(), 'declared-project-'))
    mkdirSync(join(root, '.portta'))
    writeFileSync(
      join(root, '.portta/project.yaml'),
      ['version: 1', 'worktrees:', '  branchPattern: "{slug}/{type}"', ''].join('\n'),
    )
    expect(readDeclaredProjectConfig(root).worktrees.branchPattern).toBe('{slug}/{type}')
  })

  it('uses the same defaults a missing or invalid file gets', () => {
    const missing = mkdtempSync(join(tmpdir(), 'declared-missing-'))
    expect(readDeclaredProjectConfig(missing).worktrees.branchPattern).toBe(PROJECT_CONFIG_DEFAULTS.branchPattern)

    const invalid = mkdtempSync(join(tmpdir(), 'declared-invalid-'))
    mkdirSync(join(invalid, '.portta'))
    writeFileSync(join(invalid, '.portta/project.yaml'), 'version: 1\nworktrees:\n  branchPattern: "{type}/{domain}"\n')
    expect(readDeclaredProjectConfig(invalid).worktrees.branchPattern).toBe(PROJECT_CONFIG_DEFAULTS.branchPattern)
  })
})
