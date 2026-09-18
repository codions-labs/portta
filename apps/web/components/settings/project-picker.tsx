'use client'

// Which Projects an account reaches.
//
// A developer or a viewer sees the Projects they are a member of and nothing
// else; owner and admin see everything and are never asked. An empty list is a
// real answer — an account that reaches no Project yet — so it is not treated
// as "not chosen".

import type { ProjectSummary } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/field'

export function ProjectPicker({
  projects,
  selected,
  onChange,
  disabled = false,
}: {
  projects: ProjectSummary[]
  selected: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('settings')
  const chosen = new Set(selected)

  if (projects.length === 0) {
    return <p className="text-xs text-subtle">{t('users.noProjectsYet')}</p>
  }

  return (
    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-line px-2 py-1.5 scroll-thin">
      {projects.map((project) => {
        const id = Number(project.id)
        return (
          <label key={project.id} className="flex items-center gap-2 text-sm text-muted">
            <Checkbox
              checked={chosen.has(id)}
              disabled={disabled}
              onChange={(event) => {
                const next = new Set(chosen)
                if (event.currentTarget.checked) next.add(id)
                else next.delete(id)
                onChange([...next].sort((left, right) => left - right))
              }}
            />
            <span className="truncate">{project.name}</span>
            <span className="truncate text-2xs text-subtle">{project.slug}</span>
          </label>
        )
      })}
    </div>
  )
}
