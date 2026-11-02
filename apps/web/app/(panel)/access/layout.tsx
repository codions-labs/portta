import type { ReactNode } from 'react'
import { AccessSections } from '@/components/access-sections'
import { pageNeeds } from '@/lib/server/page-data'

export default async function AccessLayout({ children }: { children: ReactNode }) {
  await pageNeeds('access:read')
  return (
    <>
      <AccessSections />
      {children}
    </>
  )
}
