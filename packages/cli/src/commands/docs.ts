import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Command } from 'commander'
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
import { type DocumentationOperation, type DocumentationReader, remoteDocumentationReader } from 'portta-mcp'
import { z } from 'zod'
import { CliError, PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { clientFor } from './work.js'

export type { DocumentationOperation, DocumentationReader }
export { remoteDocumentationReader }

export function loadLocalDocumentation(): DocumentationCorpus {
  // In a release this module is bundled into dist/cli.js. Source runs use the
  // generated checkout artifact, with no dependency on cwd or PORTTA_ROOT.
  const file = import.meta.url.endsWith('/cli.js')
    ? new URL('./documentation.json', import.meta.url)
    : new URL('../../../../docs/.generated/corpus.json', import.meta.url)
  try {
    const corpus = JSON.parse(readFileSync(file, 'utf8')) as DocumentationCorpus
    if (corpus.schemaVersion !== 1) throw new Error('unsupported corpus version')
    return corpus
  } catch {
    throw new PreconditionError(
      `documentation is unavailable at ${fileURLToPath(file)}`,
      'reinstall this CLI or run npm run docs:generate in the checkout',
    )
  }
}

export function localDocumentationReader(load = loadLocalDocumentation): DocumentationReader {
  return async (operation, input) => {
    const corpus = load()
    if (operation === 'list') {
      const query = DocumentationListQuery.parse(input)
      return documentationNavigation(corpus, query.audience)
    }
    if (operation === 'search') {
      const query = DocumentationSearchQuery.parse(input)
      return { identity: corpus.identity, results: searchDocumentation(corpus.pages, query.q, query) }
    }
    const query = DocumentationPageQuery.parse(input)
    const page = getDocumentationPage(corpus, query.slug, query.anchor)
    if (!page) throw new CliError('no such document or heading')
    return DocumentationPageResponse.parse({ identity: corpus.identity, page })
  }
}

export async function docsCommand(
  operation: DocumentationOperation,
  value: string | undefined,
  command: Command,
): Promise<void> {
  const options = command.optsWithGlobals() as {
    url?: string
    audience?: string
    limit?: string
    anchor?: string
    json?: boolean
    quiet?: boolean
  }
  const output = new Output(options)
  const reader = options.url
    ? remoteDocumentationReader((path) => clientFor(command).client.request('GET', path))
    : localDocumentationReader()
  const input =
    operation === 'show'
      ? { slug: value, ...(options.anchor ? { anchor: options.anchor } : {}) }
      : {
          ...(options.audience ? { audience: options.audience } : {}),
          ...(operation === 'search' ? { q: value, ...(options.limit ? { limit: options.limit } : {}) } : {}),
        }
  try {
    const answer = await reader(operation, input)
    const origin = options.url ? 'panel' : 'local'
    if (output.json) {
      output.data({ origin, ...answer })
      return
    }
    const identity = answer.identity as DocumentationCorpus['identity']
    output.line(`Portta ${identity.version} documentation (${origin}, ${identity.hash.slice(0, 12)})`)
    if (operation === 'show') {
      const { page } = DocumentationPageResponse.parse(answer)
      output.line(`${page.url}\n\n${page.markdown}`)
    } else if (operation === 'list') {
      for (const page of DocumentationIndex.parse(answer).pages)
        output.line(`${page.slug}  ${page.title} [${page.audience} / ${page.section}]`)
    } else {
      const { results } = DocumentationSearchResponse.parse(answer)
      if (!results.length) output.line('No matching documentation.')
      for (const hit of results) output.line(`${hit.url}  ${hit.title}\n  ${hit.excerpt}`)
    }
  } catch (error) {
    if (error instanceof z.ZodError) throw new UsageError(error.issues.map((issue) => issue.message).join('; '))
    throw error
  }
}
