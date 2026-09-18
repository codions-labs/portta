'use client'

import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { useTaskflowProject } from '../../lib/project.tsx'
import { cn } from '../../lib/utils.ts'

const STATUS_STYLE = {
  ok: 'text-ok',
  warning: 'text-warn',
  error: 'text-danger',
  skipped: 'text-subtle',
} as const

export function DiagnosticsPanel() {
  const { t } = useTranslation('taskflow', { keyPrefix: 'settings.diagnostics' })
  // Diagnostics run on request and take a while; the result is not cached state.
  const { api } = useTaskflowProject()
  const diagnostics = useMutation({ mutationFn: () => api.fetchDiagnostics() })
  const result = diagnostics.data ?? null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-ink">{t('title')}</p>
          <p className="mt-0.5 text-xs text-subtle">{t('description')}</p>
        </div>
        <Button size="sm" onClick={() => diagnostics.mutate()} busy={diagnostics.isPending}>
          {t('run')}
        </Button>
      </div>
      {diagnostics.error ? <ErrorBox error={diagnostics.error} /> : null}
      {result ? (
        <div className="space-y-2" aria-live="polite">
          <p className={cn('text-xs', result.ready ? 'text-ok' : 'text-danger')}>
            {result.ready ? t('ready') : t('actionRequired')}
          </p>
          {result.checks.map((item) => (
            <div className="rounded-md border border-line bg-surface px-2.5 py-2" key={item.id}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs text-ink">{item.label}</span>
                <span className={cn('text-2xs uppercase', STATUS_STYLE[item.status])}>
                  {t(`status.${item.status}`)}
                </span>
              </div>
              <p className="mt-0.5 text-2xs text-subtle">{item.summary}</p>
              {item.remediation ? <p className="mt-1 text-2xs text-warn">{item.remediation}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
