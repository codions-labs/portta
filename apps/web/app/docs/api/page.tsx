import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ApiReference } from '@/components/docs/api'
import { DocsBreadcrumbs } from '@/components/docs/breadcrumbs'
import { hasDeps, serverDeps } from '@/lib/server/deps'

// The console issues real requests against this panel, so the page is rendered
// on request rather than baked into the build: what it documents is whatever
// this process is serving right now.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'API reference · Documentation',
  description: 'The OpenAPI contract served by this Portta panel.',
}

export default function ApiPage() {
  if (hasDeps() && !serverDeps().config.apiDocs) notFound()
  return (
    <>
      <DocsBreadcrumbs section="Reference" title="API reference" />
      <ApiReference />
    </>
  )
}
