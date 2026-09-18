'use client'

// What this browser prefers for Taskflow, the same for every Project: the
// interface a new session opens in, and the SSH host "Open in Cursor" uses.

import { type FormEvent, useId, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/toast'
import { usePreferences } from '../../lib/preferences.tsx'

export function BrowserPreferences({ onWebChatUiChange }: { onWebChatUiChange?: (enabled: boolean) => void }) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'settings' })
  const { t: tc } = useTranslation('common')
  const toast = useToast()
  const preferences = usePreferences()
  const formId = useId()
  const [sshHost, setSshHost] = useState(preferences.sshHost)

  function handleSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    preferences.setSshHost(sshHost)
    toast.push({ tone: 'ok', title: t('ssh.saved') })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-subtle">{t('browser.description')}</p>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm text-ink">{t('interface.webChat')}</span>
          <p className="mt-0.5 text-xs text-subtle">{t('interface.webChatHint')}</p>
        </div>
        <Switch
          checked={preferences.useWebChatUi}
          onCheckedChange={onWebChatUiChange ?? preferences.setUseWebChatUi}
          aria-label={t('interface.webChat')}
        />
      </div>
      <form id={formId} className="flex flex-wrap items-end gap-2" onSubmit={handleSave}>
        <Field
          className="min-w-0 flex-1"
          label={`${t('ssh.label')} ${t('ssh.qualifier')}`}
          hint={<Trans t={t} i18nKey="ssh.hint" components={{ code: <code className="font-mono" /> }} />}
          id={`${formId}-ssh-host`}
        >
          <Input
            id={`${formId}-ssh-host`}
            type="text"
            mono
            placeholder={t('ssh.placeholder')}
            value={sshHost}
            onChange={(event) => setSshHost(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" size="sm" className="mb-5">
          {tc('save')}
        </Button>
      </form>
    </div>
  )
}
