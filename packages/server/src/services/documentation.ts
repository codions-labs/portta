import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DocumentationCorpus } from 'portta-core'
import { compileDocumentation, validateDocumentation } from 'portta-core/documentation-compile'

const cache = new Map<string, DocumentationCorpus>()
/** The corpus is shipped beside the application, never read from the host's PORTTA_ROOT. */
export function loadDocumentation(
  root = process.env.PORTTA_RUNTIME_DOCS_ROOT ?? resolve(process.cwd(), '../..'),
): DocumentationCorpus {
  const file = resolve(root, 'docs/.generated/corpus.json')
  const existing = cache.get(file)
  if (existing && process.env.NODE_ENV === 'production') return existing
  let corpus: DocumentationCorpus
  // Development mounts Markdown read-only. Compile in memory so editing a page
  // never writes into that mount or requires restarting the application.
  if (process.env.NODE_ENV !== 'production' && existsSync(resolve(root, 'docs/navigation.json'))) {
    const manifest: unknown = JSON.parse(readFileSync(resolve(root, 'docs/navigation.json'), 'utf8'))
    const sources: Record<string, string> = {}
    for (const directory of ['docs/product', 'docs/development']) {
      for (const name of readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' }).filter((name) =>
        name.endsWith('.md'),
      ))
        sources[`${directory}/${name}`] = readFileSync(resolve(root, directory, name), 'utf8')
    }
    sources['CHANGELOG.md'] = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          manifest,
          sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => (a < b ? -1 : 1))),
        }),
      )
      .digest('hex')
    if (existing?.identity.hash === hash) return existing
    const version = JSON.parse(readFileSync(resolve(root, 'packages/cli/package.json'), 'utf8')).version as string
    corpus = compileDocumentation(manifest, sources, { version, revision: null, hash })
    validateDocumentation(
      corpus,
      [...Object.keys(sources), ...readdirSync(resolve(root, 'docs/images')).map((name) => `docs/images/${name}`)],
      {},
      false,
    )
  } else corpus = JSON.parse(readFileSync(file, 'utf8')) as DocumentationCorpus
  if (corpus.schemaVersion !== 1) throw new Error('unsupported documentation corpus; rebuild this installation')
  cache.set(file, corpus)
  return corpus
}
