import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { EnvironmentShell } from '@/components/environments/environment-shell'
import { pageNeeds } from '@/lib/server/page-data'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params
  return { title: decodeURIComponent(name) }
}

/**
 * Whether this page exists for this person, and the frame it renders in.
 *
 * The scope — which Project adopted this environment — is the API's to enforce,
 * and it does on every request the tabs make. What the layout decides is the
 * permission, which is the same for every environment.
 */
export default async function EnvironmentLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ name: string }>
}) {
  await pageNeeds('environment:read')
  const { name } = await params
  return <EnvironmentShell name={decodeURIComponent(name)}>{children}</EnvironmentShell>
}
