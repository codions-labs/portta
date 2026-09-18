import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { developmentOverview, panelOverview } from 'portta-server'
import { OverviewView } from '@/components/overview/overview-view'
import { serverTranslation } from '@/lib/i18n/server'
import { serverDeps } from '@/lib/server/deps'
import { requirePrincipal } from '@/lib/server/principal'

// The dashboard is a picture of a running host: it is read on every request,
// never at build time, and never cached between two of them.
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('overview')
  return { title: t('title') }
}

/**
 * What is happening: the host it happens on, the work, who is on it, what
 * needs attention, what changed.
 *
 * The server reads it and hands it down, so the first paint is the dashboard
 * rather than a spinner. From there the client keeps it alive: the same query
 * refetches on its interval, and `lib/live.ts` invalidates it when Docker says
 * something changed.
 *
 * `services.*`, never `fetch('/api/…')`: the request would leave the process,
 * come back through the same dispatcher, and pay for a round trip to reach code
 * this render already has.
 */
export default async function OverviewPage() {
  const deps = serverDeps()
  // The layout above already redirected anybody without one, so this is the
  // same principal the API would resolve for the same request — the dashboard
  // sums what this person can see and nothing else.
  // The layout redirects too, and normally first; this is what keeps a
  // parallel render from throwing a real error a moment before it lands.
  const principal = await requirePrincipal()
  if (!principal) redirect('/sign-in')
  const [overview, status] = await Promise.all([developmentOverview(deps, principal), panelOverview(deps)])
  return <OverviewView initialOverview={overview} initialStatus={status} />
}
