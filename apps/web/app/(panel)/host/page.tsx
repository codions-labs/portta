import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { visibleHostSections } from '@/components/host/sections'
import { serverTranslation } from '@/lib/i18n/server'
import { pagePrincipal } from '@/lib/server/page-data'
import { HostHealthView } from './health-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await serverTranslation('nav')
  return { title: t('host') }
}

/**
 * Health, for whoever may read it. Host is a place with sections, so somebody
 * who holds another one lands on that instead of on a 404.
 */
export default async function HostPage() {
  const principal = await pagePrincipal()
  const [first] = visibleHostSections([...principal.permissions])
  if (!first) notFound()
  if (first.id !== 'health') redirect(first.href)
  return <HostHealthView />
}
