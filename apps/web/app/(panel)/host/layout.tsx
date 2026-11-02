import type { ReactNode } from 'react'
import { HostSections } from '@/components/host/host-sections'

export default function HostLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <HostSections />
      {children}
    </>
  )
}
