import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
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
import { z } from 'portta-core/zod'
import { type DocumentationOperation, type DocumentationReader, remoteDocumentationReader } from 'portta-mcp'
import { CliError, PreconditionError, UsageError } from '../errors.js'
import { Output } from '../output.js'
import { clientFor } from './work.js'

export type { DocumentationOperation, DocumentationReader }
export { remoteDocumentationReader }

/** The corpus as it ships: gzip, because it is 1.6 MB of JSON and 400 KB of it. */
export const CORPUS_FILE = 'documentation.json.gz'

export function loadLocalDocumentation(): DocumentationCorpus {
  // Beside this file in a release, whether that is dist/ or the bin/ copy the
  // applier runs from. Source runs fall back to the generated checkout
  // artifact, with no dependency on cwd or PORTTA_ROOT.
  const packaged = join(import.meta.dirname, CORPUS_FILE)
  const bundled = existsSync(packaged)
  const file = bundled ? pathToFileURL(packaged) : new URL('../../../../docs/.generated/corpus.json', import.meta.url)
  try {
    const bytes = readFileSync(file)
    const corpus = JSON.parse(
      bundled ? gunzipSync(bytes).toString('utf8') : bytes.toString('utf8'),
    ) as DocumentationCorpus
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
