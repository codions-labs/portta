'use client'

import { useTranslation } from 'react-i18next'

interface CursorButtonProps {
  url: string
}

export function CursorButton({ url }: CursorButtonProps) {
  const { t } = useTranslation('taskflow-worktrees')
  return (
    <a
      href={url}
      className="inline-flex h-5 shrink-0 items-center rounded-sm border border-accent/35 px-1.5 text-2xs font-medium text-accent no-underline hover:bg-accent/6 focus-ring"
      title={t('openInCursor')}
    >
      Cursor
    </a>
  )
}
