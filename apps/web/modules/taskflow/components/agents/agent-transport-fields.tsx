'use client'

import { useTranslation } from 'react-i18next'
import { Field, Select } from '@/components/ui/field'
import type { AgentPermissionMode, AgentTransport } from '../../lib/types.ts'

interface AgentTransportFieldsProps {
  transport: AgentTransport
  permissionMode: AgentPermissionMode
  onTransportChange: (transport: AgentTransport) => void
  onPermissionModeChange: (mode: AgentPermissionMode) => void
  allowInteractive?: boolean
}

export function AgentTransportFields({
  transport,
  permissionMode,
  onTransportChange,
  onPermissionModeChange,
  allowInteractive = true,
}: AgentTransportFieldsProps) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'agents.transport' })
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <Field label={t('transport')} id="agent-transport">
        <Select
          id="agent-transport"
          className="w-full"
          value={transport}
          onChange={(event) => onTransportChange(event.currentTarget.value === 'acp' ? 'acp' : 'native')}
        >
          <option value="native">{t('native')}</option>
          <option value="acp">ACP</option>
        </Select>
      </Field>
      <Field label={t('permissionPolicy')} id="agent-permission-mode">
        <Select
          id="agent-permission-mode"
          className="w-full"
          value={permissionMode}
          disabled={transport === 'native'}
          onChange={(event) => {
            const value = event.currentTarget.value
            onPermissionModeChange(value === 'deny' ? 'deny' : value === 'interactive' ? 'interactive' : 'workspace')
          }}
        >
          {allowInteractive ? <option value="interactive">{t('interactive')}</option> : null}
          <option value="workspace">{t('workspace')}</option>
          <option value="deny">{t('deny')}</option>
        </Select>
      </Field>
      {transport === 'acp' ? <p className="text-2xs leading-4 text-subtle sm:col-span-2">{t('acpHint')}</p> : null}
    </div>
  )
}
