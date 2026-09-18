'use client'

import { useTranslation } from 'react-i18next'
import { Field, Input } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

interface StartupEnvFieldsProps {
  startupEnvs?: Record<string, string | boolean>
  envValues: Record<string, string | boolean>
  onChange: (values: Record<string, string | boolean>) => void
}

export function StartupEnvFields({ startupEnvs = {}, envValues, onChange }: StartupEnvFieldsProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'startupEnv' })
  const envKeys = Object.keys(startupEnvs)
  if (envKeys.length === 0) return null

  function update(key: string, value: string | boolean): void {
    onChange({ ...envValues, [key]: value })
  }

  return (
    <div className="mb-4">
      <p className="mb-2 text-xs font-medium text-muted">
        {t('title')} <span className="opacity-60">{t('optional')}</span>
      </p>
      <div className="space-y-3 border-l border-line pl-3">
        {envKeys.map((key) =>
          typeof startupEnvs[key] === 'boolean' ? (
            <div className="flex items-center gap-2 text-xs text-muted" key={key}>
              <Switch
                checked={Boolean(envValues[key])}
                aria-label={key}
                onCheckedChange={(value) => update(key, value)}
              />
              {key}
            </div>
          ) : (
            <Field label={key} id={`wt-env-${key}`} key={key}>
              <Input
                id={`wt-env-${key}`}
                type="text"
                value={String(envValues[key] ?? '')}
                onChange={(event) => update(key, event.currentTarget.value)}
              />
            </Field>
          ),
        )}
      </div>
    </div>
  )
}
