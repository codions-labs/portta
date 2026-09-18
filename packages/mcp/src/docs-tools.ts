// The documentation tools: read-only, and served from whichever corpus the
// transport chose. `portta mcp` reads the corpus bundled with the CLI unless a
// panel source is selected; the panel's HTTP transport reads its own routes.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  DocumentationIndex,
  DocumentationListQuery,
  DocumentationPageQuery,
  DocumentationPageResponse,
  DocumentationSearchQuery,
  DocumentationSearchResponse,
} from 'portta-contracts'

export type DocumentationOperation = 'list' | 'search' | 'show'
export type DocumentationReader = (
  operation: DocumentationOperation,
  input: Record<string, unknown>,
) => Promise<Record<string, unknown>>
/** Where a documentation answer came from, carried on every result. */
export type DocumentationOrigin = 'local' | 'panel'

/**
 * A reader over the panel's own documentation routes. `request` is one GET
 * that answers parsed JSON or throws; a failure is reported, never replaced
 * by another corpus.
 */
export function remoteDocumentationReader(request: (path: string) => Promise<unknown>): DocumentationReader {
  return async (operation, input) => {
    const query = (
      operation === 'list'
        ? DocumentationListQuery
        : operation === 'search'
          ? DocumentationSearchQuery
          : DocumentationPageQuery
    ).parse(input)
    const params = new URLSearchParams(
      Object.entries(query)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)] as [string, string]),
    )
    const path =
      operation === 'list' ? '/documentation' : operation === 'search' ? '/documentation/search' : '/documentation/page'
    const result = await request(`${path}?${params}`)
    return (
      operation === 'list'
        ? DocumentationIndex
        : operation === 'search'
          ? DocumentationSearchResponse
          : DocumentationPageResponse
    ).parse(result)
  }
}

export const DOC_TOOL_NAMES = ['list_docs', 'search_docs', 'get_doc'] as const
export function registerDocumentationTools(
  server: McpServer,
  read: DocumentationReader,
  origin: DocumentationOrigin,
): void {
  const run = async (operation: DocumentationOperation, input: Record<string, unknown>) => {
    try {
      const result = { origin, ...(await read(operation, input)) }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      }
    }
  }
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: origin === 'panel',
  }
  server.registerTool(
    'list_docs',
    {
      title: 'List Portta documentation',
      description: 'List classified documentation and identify the selected corpus version.',
      inputSchema: DocumentationListQuery.shape,
      annotations,
    },
    (input) => run('list', input),
  )
  server.registerTool(
    'search_docs',
    {
      title: 'Search Portta documentation',
      description: 'Find concepts, instructions and references with excerpts and citable URLs.',
      inputSchema: DocumentationSearchQuery.shape,
      annotations,
    },
    (input) => run('search', input),
  )
  server.registerTool(
    'get_doc',
    {
      title: 'Read Portta documentation',
      description: 'Read canonical Markdown by slug, optionally limited to a heading subtree.',
      inputSchema: DocumentationPageQuery.shape,
      annotations,
    },
    (input) => run('show', input),
  )
}
