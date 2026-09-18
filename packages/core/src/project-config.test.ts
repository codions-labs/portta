// What a project may declare about itself, and what it may never declare.
//
// The refusals matter more than the happy path: a domain or an absolute path
// accepted here travels with the clone and is wrong on the next machine, which
// is the failure ADR 0052 exists to prevent.
import { describe, expect, it } from 'vitest'
import {
  applyBranchPattern,
  defaultProjectConfig,
  PROJECT_CONFIG_DEFAULTS,
  PROJECT_CONFIG_PATH,
  parseProjectConfig,
  proposedIssueBranch,
  slugFromTitle,
} from './project-config.ts'

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
        mainBranch: null,
        worktrees: {
          root: PROJECT_CONFIG_DEFAULTS.worktreeRoot,
          branchPattern: PROJECT_CONFIG_DEFAULTS.branchPattern,
        },
        stack: [],
        instructions: [],
      },
    })
  })

  it('keeps what the project declared', () => {
    const result = parseProjectConfig({
      version: 1,
      name: 'demo-shop',
      mainBranch: 'develop',
      worktrees: { root: 'worktrees', branchPattern: '{type}/{slug}' },
      stack: ['node', 'mysql'],
      instructions: ['AGENTS.md', 'docs/CONTRIBUTING.md'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.config.name).toBe('demo-shop')
    expect(result.config.mainBranch).toBe('develop')
    expect(result.config.worktrees.root).toBe('worktrees')
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
      expect(messages({ version: 1, worktrees: { root: 'x', port: 8080 } })).toEqual([expect.stringContaining('port')])
    })

    it('a URL', () => {
      expect(messages({ version: 1, name: 'https://example.com' })).toEqual([
        'name: the project name looks like a URL; that belongs to the host, not to the project (ADR 0052)',
      ])
    })

    it('an absolute path', () => {
      expect(messages({ version: 1, worktrees: { root: '/srv/worktrees' } })).toEqual([
        expect.stringContaining('is an absolute path'),
      ])
      expect(messages({ version: 1, instructions: ['/etc/agents.md'] })).toEqual([
        expect.stringContaining('is an absolute path'),
      ])
    })

    it('a home-relative path, which differs per machine', () => {
      expect(messages({ version: 1, worktrees: { root: '~/worktrees' } })).toEqual([
        expect.stringContaining('differs per machine'),
      ])
    })

    it('a path that escapes the repository', () => {
      expect(messages({ version: 1, worktrees: { root: '../outside' } })).toEqual([
        expect.stringContaining("escapes the repository with '..'"),
      ])
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

    it('an unknown branch-pattern placeholder', () => {
      expect(messages({ version: 1, worktrees: { branchPattern: '{type}/{domain}' } })).toEqual([
        expect.stringContaining('unknown placeholder {domain}'),
      ])
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

describe('applyBranchPattern', () => {
  it('fills the placeholders the project declared', () => {
    expect(applyBranchPattern('{type}/{slug}', { type: 'fix', slug: 'proxy-timeout' })).toBe('fix/proxy-timeout')
    expect(applyBranchPattern('{slug}-{type}', { type: 'feat', slug: 'importer' })).toBe('importer-feat')
  })

  it('leaves unknown braces alone rather than inventing a value', () => {
    expect(applyBranchPattern('{type}/{domain}', { type: 'fix', slug: 'x' })).toBe('fix/{domain}')
  })
})

describe('slugFromTitle', () => {
  it('keeps two to four kebab-case words', () => {
    expect(slugFromTitle('Proxy TCP loses the connection')).toBe('proxy-tcp-loses-the')
    expect(slugFromTitle('Ship')).toBe('ship')
    expect(slugFromTitle('  ')).toBe('work')
  })
})

describe('proposedIssueBranch', () => {
  it('uses the project pattern and defaults the type to fix', () => {
    expect(proposedIssueBranch('{type}/{slug}', 'Da issue à Run')).toBe('fix/da-issue-a-run')
    expect(proposedIssueBranch('{type}/{slug}', 'Named URLs', 'feat')).toBe('feat/named-urls')
  })
})
