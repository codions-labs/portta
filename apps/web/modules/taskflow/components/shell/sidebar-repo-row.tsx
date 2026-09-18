'use client'

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { CursorButton } from '../worktrees/cursor-button.tsx'

interface SidebarRepoRowProps {
  label: string
  cursorUrl: string
  onPull?: () => void
}

export function SidebarRepoRow({ label, cursorUrl, onPull }: SidebarRepoRowProps) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'sidebar' })
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
      <span className="truncate text-2xs font-medium text-muted">{label}</span>
      <CursorButton url={cursorUrl} />
      {onPull ? (
        <Button size="xs" className="h-5 px-1.5 text-2xs" title={t('pullTitle')} onClick={onPull}>
          {t('pull')}
        </Button>
      ) : null}
    </div>
  )
}
