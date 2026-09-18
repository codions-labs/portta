'use client'

import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/shell-bits'
import { Card, CardBody } from '@/components/ui/card'
import { BrowserPreferences } from '../components/settings/browser-preferences.tsx'
import { PreferencesProvider } from '../lib/preferences.tsx'

/** `/settings/taskflow`: what this browser prefers, for every Taskflow Project. */
export function TaskflowPreferencesPage() {
  const { t } = useTranslation('taskflow', { keyPrefix: 'preferences' })
  return (
    <PreferencesProvider>
      <PageHeader title={t('title')} description={t('description')} />
      <Card>
        <CardBody>
          <BrowserPreferences />
        </CardBody>
      </Card>
    </PreferencesProvider>
  )
}
