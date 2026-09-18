'use client'

import { useTranslation } from 'react-i18next'
import { RunView } from '../components/runs/run-view.tsx'

/** `…/runs`: the list is in the sidebar; the page waits for one to be picked. */
export function RunsPage() {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'view' })
  return (
    <div className="flex flex-1 items-center justify-center px-6 text-center">
      <div>
        <p className="text-sm font-medium text-ink">{t('selectTitle')}</p>
        <p className="mt-1 text-xs text-subtle">{t('selectHint')}</p>
      </div>
    </div>
  )
}

/** `…/runs/<id>`: one Run, live. */
export function RunPage({ id }: { id: string }) {
  return <RunView key={id} runId={id} />
}
