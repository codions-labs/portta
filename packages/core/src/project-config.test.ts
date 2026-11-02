// What a project may declare about itself, and what it may never declare.
//
// The refusals matter more than the happy path: a domain or an absolute path
// accepted here travels with the clone and is wrong on the next machine, which
// is the failure ADR 0052 exists to prevent.
import { describe, expect, it } from 'vitest'
import { defaultProjectConfig, PROJECT_CONFIG_PATH, parseProjectConfig } from './project-config.ts'

const messages = (document: unknown): string[] => {
  const result = parseProjectConfig(document)
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.message}`)
}

describe('parseProjectConfig', () => {
  it('fills in what a minimal document leaves out', () => {
    const result = parseProjectConfig({ version: 1 })
    expect(result).toEqual({
      ok: true,
      config: {
        version: 1,
        name: null,
        stack: [],
        instructions: [],
      },
    })
  })

  it('keeps what the project declared', () => {
    const result = parseProjectConfig({
      version: 1,
      name: 'demo-shop',
      stack: ['node', 'mysql'],
      instructions: ['AGENTS.md', 'docs/CONTRIBUTING.md'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.name).toBe('demo-shop')
    expect(result.config.stack).toEqual(['node', 'mysql'])
    expect(result.config.instructions).toEqual(['AGENTS.md', 'docs/CONTRIBUTING.md'])
  })

  it('a project with no file and a project that declares nothing get the same thing', () => {
    const declared = parseProjectConfig({ version: 1 })
    expect(declared.ok).toBe(true)
    if (!declared.ok) return
    expect(declared.config).toEqual(defaultProjectConfig())
  })

  describe('refuses what belongs to the host', () => {
    it('a key nobody agreed travels', () => {
      expect(messages({ version: 1, domain: 'example.com' })).toEqual([expect.stringContaining('domain')])
      expect(messages({ version: 1, port: 8080 })).toEqual([expect.stringContaining('port')])
    })

    it('a URL', () => {
      expect(messages({ version: 1, name: 'https://example.com' })).toEqual([
        'name: the project name looks like a URL; that belongs to the host, not to the project (ADR 0052)',
      ])
    })

    it('an absolute path', () => {
      expect(messages({ version: 1, instructions: ['/etc/agents.md'] })).toEqual([
        expect.stringContaining('is an absolute path'),
      ])
    })

    it('a home-relative path, which differs per machine', () => {
      expect(messages({ version: 1, instructions: ['~/agents.md'] })).toEqual([
        expect.stringContaining('differs per machine'),
      ])
    })

    it('a path that escapes the repository', () => {
      expect(messages({ version: 1, instructions: ['docs/../../secrets.md'] })).toEqual([
        expect.stringContaining("escapes the repository with '..'"),
      ])
    })

    it('a published host port', () => {
      expect(messages({ version: 1, name: '8080:3000' })).toEqual([
        expect.stringContaining('looks like a published host port'),
      ])
    })
  })

  describe('refuses a document it cannot trust', () => {
    it('a missing or unknown version', () => {
      expect(messages({ name: 'demo' })).toEqual([expect.stringContaining('version')])
      expect(messages({ version: 2 })).toEqual([expect.stringContaining('version')])
    })

    it('an empty document', () => {
      expect(messages(null)).toEqual([`: ${'project.yaml'} is empty`])
      expect(messages(undefined)).toEqual([`: ${'project.yaml'} is empty`])
    })

    it('a stack entry that is not a plain identifier', () => {
      expect(messages({ version: 1, stack: ['node 22 (from the VPS)'] })).toEqual([
        expect.stringContaining('plain identifier'),
      ])
    })
  })

  it('names the file it describes', () => {
    expect(PROJECT_CONFIG_PATH).toBe('.portta/project.yaml')
  })
})
