'use client'

// Everything Settings shares: its name, the search, and the sections beside the
// page. A section of `.env` tells the rail how many changes it holds unsaved.

import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shell-bits'
import { SettingsNav } from './settings-nav'
import { SettingsSearch } from './settings-search'

const DirtyContext = createContext<{
  counts: ReadonlyMap<string, number>
  report: (counts: ReadonlyMap<string, number>) => void
}>({ counts: new Map(), report: () => undefined })

export function useDirtyCounts() {
  return useContext(DirtyContext).counts
}

export function useReportDirty(counts: ReadonlyMap<string, number>) {
  const { report } = useContext(DirtyContext)
  useEffect(() => {
    report(counts)
    return () => report(new Map())
  }, [counts, report])
}

export function SettingsShell({ signsPeopleIn, children }: { signsPeopleIn: boolean; children: ReactNode }) {
  const { t } = useTranslation('settings')
  const [counts, report] = useState<ReadonlyMap<string, number>>(new Map())
  const value = useMemo(() => ({ counts, report }), [counts])

  return (
    <DirtyContext.Provider value={value}>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={<SettingsSearch signsPeopleIn={signsPeopleIn} />}
      />
      <div className="flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
        <SettingsNav signsPeopleIn={signsPeopleIn} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </DirtyContext.Provider>
  )
}

/** The name of a section, under the page's own. */
export function SettingsHeading({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 max-w-2xl text-sm text-subtle">{description}</p> : null}
      </div>
      {actions ? <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
