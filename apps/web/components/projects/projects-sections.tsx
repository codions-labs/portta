'use client'

// The ways to read the same catalogue: by project, by service, or every
// environment the host runs, adopted or not.

import { useTranslation } from 'react-i18next'
import { LinkTabs } from '@/components/ui/tabs'
import { usePrincipal } from '@/lib/principal'

const SECTIONS = [
  { id: 'projects', href: '/projects', permission: 'project:read' },
  { id: 'services', href: '/projects?view=services', permission: 'service:read' },
  { id: 'environments', href: '/projects?view=environments', permission: 'environment:read' },
] as const

export function ProjectsSections({ active }: { active: (typeof SECTIONS)[number]['id'] }) {
  const { t } = useTranslation('nav')
  const held = new Set(usePrincipal().permissions)
  return (
    <LinkTabs
      label={t('projects')}
      active={active}
      tabs={SECTIONS.filter((section) => held.has(section.permission)).map((section) => ({
        id: section.id,
        label: t(`projectSections.${section.id}`),
        href: section.href,
      }))}
    />
  )
}
