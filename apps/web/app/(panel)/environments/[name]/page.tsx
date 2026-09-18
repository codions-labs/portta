import { Suspense } from 'react'
import { EnvironmentOverview } from '@/components/environments/environment-overview'
import { Loading } from '@/components/shell-bits'

export const dynamic = 'force-dynamic'

export default async function EnvironmentOverviewPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return (
    // The selected service is a query parameter, and Next wants what reads one
    // to be able to render on its own.
    <Suspense fallback={<Loading />}>
      <EnvironmentOverview name={decodeURIComponent(name)} />
    </Suspense>
  )
}
