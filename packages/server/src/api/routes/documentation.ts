import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import {
  DocumentationIndex,
  DocumentationListQuery,
  DocumentationPageQuery,
  DocumentationPageResponse,
  DocumentationSearchQuery,
  DocumentationSearchResponse,
} from 'portta-contracts'
import {
  type DocumentationCorpus,
  documentationNavigation,
  getDocumentationPage,
  searchDocumentation,
} from 'portta-core'
import type { AppDeps } from '../../deps.ts'
import { loadDocumentation } from '../../services/documentation.ts'
import { documentRoute } from '../openapi.ts'

export function documentationRoutes(
  deps: Pick<AppDeps, 'config'>,
  load: () => DocumentationCorpus = loadDocumentation,
): Hono {
  const app = new Hono()
  const corpus = () => {
    if (!deps.config.docs) throw new HTTPException(404, { message: 'documentation is disabled' })
    return load()
  }
  const audience = {
    name: 'audience',
    in: 'query' as const,
    schema: { type: 'string' as const, enum: ['user', 'developer', 'all'], default: 'all' },
  }
  app.get(
    '/documentation',
    documentRoute({
      tag: 'Documentation',
      authenticated: true,
      operationId: 'listDocumentation',
      summary: 'List the installed documentation and its navigation',
      response: DocumentationIndex,
      errors: [400, 404],
      parameters: [audience],
    }),
    (c) => {
      const query = DocumentationListQuery.parse(c.req.query())
      return c.json(documentationNavigation(corpus(), query.audience))
    },
  )
  app.get(
    '/documentation/search',
    documentRoute({
      tag: 'Documentation',
      authenticated: true,
      operationId: 'searchDocumentation',
      summary: 'Search the installed documentation',
      response: DocumentationSearchResponse,
      errors: [400, 404],
      parameters: [
        audience,
        { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 1, maxLength: 200 } },
        { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      ],
    }),
    (c) => {
      const query = DocumentationSearchQuery.parse(c.req.query())
      const docs = corpus()
      return c.json({ identity: docs.identity, results: searchDocumentation(docs.pages, query.q, query) })
    },
  )
  app.get(
    '/documentation/page',
    documentRoute({
      tag: 'Documentation',
      authenticated: true,
      operationId: 'getDocumentationPage',
      summary: 'Read a document or one heading subtree as Markdown',
      response: DocumentationPageResponse,
      errors: [400, 404],
      parameters: [
        {
          name: 'slug',
          in: 'query',
          required: true,
          schema: { type: 'string', pattern: '^[a-z0-9]+(?:[/-][a-z0-9]+)*$' },
        },
        { name: 'anchor', in: 'query', schema: { type: 'string', minLength: 1, maxLength: 300 } },
      ],
    }),
    (c) => {
      const query = DocumentationPageQuery.parse(c.req.query())
      const docs = corpus()
      const page = getDocumentationPage(docs, query.slug, query.anchor)
      if (!page) throw new HTTPException(404, { message: 'no such document or heading' })
      return c.json(DocumentationPageResponse.parse({ identity: docs.identity, page }))
    },
  )
  return app
}
