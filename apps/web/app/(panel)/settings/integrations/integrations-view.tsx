'use client'

// What the panel reads work from, and whether it can.
//
// There is nothing to edit here any more. Both providers are authenticated on
// the host — `gh auth login` for GitHub, `LINEAR_API_KEY` for Linear — and the
// panel is a container that can hold neither credential (ADR 0018, ADR 0047).
// What it can do is say which of the two is reachable and name the command that
// fixes the one that is not, which is what this page is.

import { useTranslation } from 'react-i18next'
import { ForgeStatusCard } from '@/components/forge-status'
import { PageHeader } from '@/components/shell-bits'

export function IntegrationsView() {
  const { t } = useTranslation('settings')

  return (
    <>
      <PageHeader title={t('integrations.title')} description={t('integrations.description')} />
      <div className="grid gap-4">
        <ForgeStatusCard />
      </div>
    </>
  )
}
