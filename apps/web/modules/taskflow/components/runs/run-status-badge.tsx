'use client'

import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { Tone } from '@/lib/tone'
import type { RunDetailResponse } from '../../lib/types.ts'

type RunStatus =
  | RunDetailResponse['run']['status']
  | RunDetailResponse['run']['executions'][number]['status']
  | 'pending'
  | 'closed'

interface RunStatusBadgeProps {
  status: RunStatus
}

function statusTone(status: RunStatus): Tone {
  if (status === 'completed') return 'ok'
  if (status === 'failed') return 'danger'
  if (status === 'cancelled' || status === 'interrupted') return 'warn'
  if (status === 'running') return 'accent'
  return 'neutral'
}

export function RunStatusBadge({ status }: RunStatusBadgeProps) {
  const { t } = useTranslation('taskflow-runs', { keyPrefix: 'status' })
  return (
    <Badge tone={statusTone(status)} shape="pill" dot={status === 'running'}>
      {t(status)}
    </Badge>
  )
}
