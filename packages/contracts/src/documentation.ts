import { z } from 'zod'

export const DocumentationAudience = z.enum(['user', 'developer', 'all'])
export const DocumentationIdentity = z.object({
  version: z.string(),
  revision: z.string().nullable(),
  hash: z.string(),
})
export const DocumentationHeading = z.object({
  id: z.string(),
  text: z.string(),
  level: z.number().int(),
  line: z.number().int(),
})
export const DocumentationMetadata = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  audience: z.enum(['user', 'developer']),
  section: z.string(),
  category: z.string(),
  source: z.string(),
  url: z.string(),
  kind: z.enum(['markdown', 'api']),
})
export const DocumentationGroup = z.object({
  title: z.string(),
  category: z.string(),
  audience: z.enum(['user', 'developer']),
  sequential: z.boolean(),
  slugs: z.array(z.string()),
})
export const DocumentationIndex = z.object({
  identity: DocumentationIdentity,
  groups: z.array(DocumentationGroup),
  pages: z.array(DocumentationMetadata),
})
export const DocumentationPageResponse = z.object({
  identity: DocumentationIdentity,
  page: DocumentationMetadata.extend({ markdown: z.string(), headings: z.array(DocumentationHeading) }),
})
export const DocumentationSearchResponse = z.object({
  identity: DocumentationIdentity,
  results: z.array(
    z.object({
      slug: z.string(),
      title: z.string(),
      description: z.string(),
      audience: z.enum(['user', 'developer']),
      section: z.string(),
      category: z.string(),
      url: z.string(),
      anchor: z.string().nullable(),
      excerpt: z.string(),
    }),
  ),
})
export const DocumentationListQuery = z.object({ audience: DocumentationAudience.default('all') }).strict()
export const DocumentationSearchQuery = DocumentationListQuery.extend({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})
export const DocumentationPageQuery = z
  .object({ slug: z.string().regex(/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/), anchor: z.string().min(1).max(300).optional() })
  .strict()
