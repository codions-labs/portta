import { Suspense } from 'react'
import { Loading } from '@/components/shell-bits'
import { pageNeeds } from '@/lib/server/page-data'
import { LogsView } from './logs-view'

export const dynamic = 'force-dynamic'

export default async function EnvironmentLogsPage({ params }: { params: Promise<{ name: string }> }) {
  // Reading logs is its own permission: a viewer has it, and holds nothing that
  // could act on what they are reading.
  await pageNeeds('logs:read')
  const { name } = await params
  return (
    <Suspense fallback={<Loading />}>
      <LogsView name={decodeURIComponent(name)} />
    </Suspense>
  )
}
