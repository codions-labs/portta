import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it, vi } from 'vitest'
import {
  DOC_TOOL_NAMES,
  type DocumentationReader,
  registerDocumentationTools,
  remoteDocumentationReader,
} from './docs-tools.ts'

const identity = { version: 'test', revision: null, hash: 'same' }
const page = {
  slug: 'routing',
  title: 'Routing',
  url: '/docs/routing',
  audience: 'user',
  section: 'Guides',
  description: 'Configure hostnames.',
  markdown: '# Routing\n\nUse a wildcard record.',
  headings: [],
}
const read: DocumentationReader = async (operation, input) => {
  if (operation === 'show' && input.slug !== 'routing') throw new Error('no such document or heading')
  return { identity, ...(operation === 'show' ? { page } : {}) }
}

describe('the documentation tools', () => {
  it('are read-only, answer structured content, and report a failure as an error', async () => {
    const server = new McpServer({ name: 'test', version: '1' })
    registerDocumentationTools(server, read, 'local')
    const tools = (
      server as unknown as {
        _registeredTools: Record<
          string,
          {
            handler: (input: unknown) => Promise<{ structuredContent?: unknown; isError?: boolean }>
            annotations: { readOnlyHint: boolean }
          }
        >
      }
    )._registeredTools
    expect(Object.keys(tools)).toEqual([...DOC_TOOL_NAMES])
    const getDoc = tools.get_doc
    if (!getDoc) throw new Error('missing registered get_doc tool')
    expect(getDoc.annotations.readOnlyHint).toBe(true)
    const result = await getDoc.handler({ slug: 'routing', anchor: 'dns' })
    expect(result.structuredContent).toMatchObject({ origin: 'local', identity })
    expect((await getDoc.handler({ slug: 'unknown' })).isError).toBe(true)
  })

  // An explicitly selected corpus that fails is a failure, not a fallback.
  it('does not substitute another corpus when the selected panel fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('panel unavailable'))
    await expect(remoteDocumentationReader(request)('show', { slug: 'routing', anchor: 'dns' })).rejects.toThrow(
      'panel unavailable',
    )
    expect(request).toHaveBeenCalledWith('/documentation/page?slug=routing&anchor=dns')
  })
})
