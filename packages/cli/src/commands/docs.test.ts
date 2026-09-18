import { compileDocumentation } from 'portta-core/documentation-compile'
import { describe, expect, it, vi } from 'vitest'
import { localDocumentationReader, remoteDocumentationReader } from './docs.js'

const corpus = compileDocumentation(
  {
    groups: [
      {
        title: 'Guides',
        category: '',
        audience: 'user',
        pages: [{ source: 'docs/product/a.md', slug: 'routing', description: 'Configure hostnames.' }],
      },
    ],
  },
  { 'docs/product/a.md': '# Routing\n\n## DNS\n\nUse a wildcard record.\n\n## TLS\n\nUse certificates.' },
  { version: 'test', revision: null, hash: 'same' },
)

describe('documentation interfaces', () => {
  it('reads and searches locally without network or a panel', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    try {
      const read = localDocumentationReader(() => corpus)
      expect((await read('list', {})).identity).toEqual(corpus.identity)
      expect((await read('search', { q: 'wildcard' })).results).toHaveLength(1)
      const answer = await read('show', { slug: 'routing', anchor: 'dns' })
      expect(JSON.stringify(answer)).toContain('wildcard')
      expect(JSON.stringify(answer)).not.toContain('certificates')
      expect(network).not.toHaveBeenCalled()
      await expect(read('show', { slug: 'routing', anchor: 'missing' })).rejects.toThrow('no such')
      await expect(read('search', { q: 'wildcard', limit: 51 })).rejects.toThrow()
    } finally {
      network.mockRestore()
    }
  })
  it('does not substitute a local version when an explicitly selected panel fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('panel unavailable'))
    await expect(remoteDocumentationReader(request)('show', { slug: 'routing', anchor: 'dns' })).rejects.toThrow(
      'panel unavailable',
    )
    expect(request).toHaveBeenCalledWith('/documentation/page?slug=routing&anchor=dns')
  })
})
