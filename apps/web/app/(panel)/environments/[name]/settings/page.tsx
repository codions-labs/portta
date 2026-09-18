import { pageNeeds } from '@/lib/server/page-data'
import { EnvironmentSettingsView } from './settings-view'

export const dynamic = 'force-dynamic'

export default async function EnvironmentSettingsPage({ params }: { params: Promise<{ name: string }> }) {
  // Overrides are an environment's settings, not an operation on it.
  await pageNeeds('environment:settings')
  const { name } = await params
  return <EnvironmentSettingsView name={decodeURIComponent(name)} />
}
