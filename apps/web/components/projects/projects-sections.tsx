'use client'

// The shapes the same catalogue takes: grouped by project, as a table to act on
// several at once, or service by service.

import { Boxes, Container, Table2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslation } from 'react-i18next'
import { Segmented } from '@/components/ui/segmented'
import { usePrincipal } from '@/lib/principal'
import type { ProjectView } from '@/lib/projects'

export const VIEW_STORAGE = 'portta-projects-view'

function remember(view: ProjectView): void {
  try {
    localStorage.setItem(VIEW_STORAGE, view)
  } catch {
    /* private browsing */
  }
}

export function ProjectsSections({
  active,
  onChoose,
}: {
  active: ProjectView | 'services'
  /** Set on the page that draws both project views, so switching them needs no navigation. */
  onChoose?: (view: ProjectView) => void
}) {
  const { t } = useTranslation('nav', { keyPrefix: 'projectSections' })
  const router = useRouter()
  const held = new Set(usePrincipal().permissions)

  const choose = (next: ProjectView | 'services') => {
    if (next === 'services') {
      router.push('/projects?view=services')
      return
    }
    remember(next)
    if (onChoose) onChoose(next)
    else router.push('/projects')
  }

  return (
    <Segmented
      label={t('label')}
      value={active}
      onChange={choose}
      options={[
        ...(held.has('project:read')
          ? [
              { value: 'cards' as const, label: t('projects'), icon: Boxes },
              { value: 'table' as const, label: t('table'), icon: Table2 },
            ]
          : []),
        ...(held.has('service:read') ? [{ value: 'services' as const, label: t('services'), icon: Container }] : []),
      ]}
    />
  )
}
