import { describe, expect, it } from 'vitest'
import {
  GIT_LOG_FORMAT,
  isInstructionPath,
  parseGitLog,
  REPOSITORY_KEY,
  repositoryKey,
  specificationOf,
  specificationTitle,
} from './repos-scan.js'

describe('instruction allowlist', () => {
  it('accepts the documented files and nothing else', () => {
    expect(isInstructionPath('AGENTS.md')).toBe(true)
    expect(isInstructionPath('./CLAUDE.md')).toBe(true)
    expect(isInstructionPath('.github/copilot-instructions.md')).toBe(true)
    expect(isInstructionPath('.cursor/rules/style.mdc')).toBe(true)
    expect(isInstructionPath('.cursor/rules/nested/style.mdc')).toBe(false)
    expect(isInstructionPath('.cursor/rules/style.md')).toBe(false)
    expect(isInstructionPath('README.md')).toBe(false)
    expect(isInstructionPath('.env')).toBe(false)
    expect(isInstructionPath('../AGENTS.md')).toBe(false)
    expect(isInstructionPath('/etc/passwd')).toBe(false)
    expect(isInstructionPath('docs/AGENTS.md')).toBe(false)
  })
})

describe('specification allowlist', () => {
  it('recognises decision records at the root and under docs, and not an index beside them', () => {
    expect(specificationOf('docs/development/adr/0053-spec-aware.md')).toEqual({ provider: 'adr', kind: 'decision' })
    expect(specificationOf('docs/adr/0001-record.md')).toEqual({ provider: 'adr', kind: 'decision' })
    expect(specificationOf('doc/architecture/decisions/0002-x.md')).toEqual({ provider: 'adr', kind: 'decision' })
    expect(specificationOf('adr/0001-record.md')).toEqual({ provider: 'adr', kind: 'decision' })
    expect(specificationOf('docs/development/adr/README.md')).toBeNull()
    expect(specificationOf('docs/development/adr/template.md')).toBeNull()
    expect(specificationOf('docs/development/adr/0001-record.txt')).toBeNull()
    expect(specificationOf('src/adr/0001-record.md')).toBeNull()
    expect(specificationOf('docs/a/b/c/d/adr/0001-record.md')).toBeNull()
  })

  it('recognises an OpenSpec tree by its documents', () => {
    expect(specificationOf('openspec/project.md')).toEqual({ provider: 'openspec', kind: 'context' })
    expect(specificationOf('openspec/specs/auth/spec.md')).toEqual({ provider: 'openspec', kind: 'specification' })
    expect(specificationOf('openspec/changes/add-login/proposal.md')).toEqual({ provider: 'openspec', kind: 'change' })
    expect(specificationOf('openspec/changes/add-login/tasks.md')).toEqual({ provider: 'openspec', kind: 'tasks' })
    expect(specificationOf('openspec/changes/add-login/specs/auth/spec.md')).toEqual({
      provider: 'openspec',
      kind: 'specification',
    })
    expect(specificationOf('openspec/AGENTS.md')).toBeNull()
    expect(specificationOf('openspec/changes/add-login/notes.md')).toBeNull()
  })

  it('attributes a specs tree to Spec Kit only beside its marker', () => {
    expect(specificationOf('specs/001-login/spec.md', { specKit: true })).toEqual({
      provider: 'spec-kit',
      kind: 'specification',
    })
    expect(specificationOf('specs/001-login/plan.md', { specKit: true })).toEqual({
      provider: 'spec-kit',
      kind: 'plan',
    })
    expect(specificationOf('.specify/memory/constitution.md', { specKit: true })).toEqual({
      provider: 'spec-kit',
      kind: 'constitution',
    })
    expect(specificationOf('specs/001-login/spec.md')).toBeNull()
    expect(specificationOf('.specify/memory/constitution.md')).toBeNull()
    expect(specificationOf('specs/001-login/notes.md', { specKit: true })).toBeNull()
    expect(specificationOf('.specify/templates/spec.md', { specKit: true })).toBeNull()
  })

  it('refuses what leaves the repository or is never read', () => {
    expect(specificationOf('../docs/adr/0001-record.md')).toBeNull()
    expect(specificationOf('/etc/adr/0001-record.md')).toBeNull()
    expect(specificationOf('docs/adr/.env')).toBeNull()
  })

  it('reads a title from the first heading or the front matter', () => {
    expect(specificationTitle('# 0053. Portta is spec-aware\n\nbody')).toBe('0053. Portta is spec-aware')
    expect(specificationTitle('---\ntitle: "Add login"\nstatus: draft\n---\n# Heading')).toBe('Add login')
    expect(specificationTitle('intro line\n\n## Only a subheading')).toBeNull()
    expect(specificationTitle('# Trailing hashes ##')).toBe('Trailing hashes')
  })
})

describe('repository key', () => {
  it('is twelve hex characters, stable, and independent of a trailing slash', () => {
    const key = repositoryKey('/srv/projects/shop/')
    expect(key).toMatch(REPOSITORY_KEY)
    expect(repositoryKey('/srv/projects/shop')).toBe(key)
    expect(repositoryKey('/srv/projects/other')).not.toBe(key)
  })
})

describe('git log', () => {
  it('parses the unit-separated format and caps the list', () => {
    const line = (n: number) =>
      `${'a'.repeat(39)}${n}\x1fabc${n}\x1fSubject ${n}\x1fAda\x1fada@example.com\x1f170000000${n}`
    const raw = [line(1), line(2), 'garbage', line(3)].join('\n')
    const commits = parseGitLog(raw, 2)
    expect(commits).toHaveLength(2)
    expect(commits[0]).toEqual({
      sha: `${'a'.repeat(39)}1`,
      shortSha: 'abc1',
      subject: 'Subject 1',
      author: 'Ada',
      email: 'ada@example.com',
      date: 1700000001,
    })
    expect(GIT_LOG_FORMAT).toContain('%x1f')
  })
})
