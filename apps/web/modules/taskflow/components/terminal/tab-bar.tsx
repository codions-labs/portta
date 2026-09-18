'use client'

import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { iconButton } from '@/components/ui/surfaces'
import type { WorktreeTab } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'

interface TabBarProps {
  tabs: WorktreeTab[]
  activeTabId: string | null
  busy?: boolean
  onCreate: () => void
  onSelect: (tabId: string) => void
  onDelete: (tabId: string) => void
}

export function TabBar({ tabs, activeTabId, busy = false, onCreate, onSelect, onDelete }: TabBarProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'tabs' })
  return (
    <nav className="flex items-stretch overflow-x-auto border-b border-line bg-surface scroll-thin">
      {tabs.map((tab) => {
        const active = activeTabId === tab.tabId
        return (
          <div
            className={cn(
              'relative flex items-center border-r border-line',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              active ? 'after:bg-accent' : 'after:bg-transparent',
            )}
            key={tab.tabId}
          >
            <button
              type="button"
              className={cn(
                'whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors duration-100 focus-ring-inset',
                active ? 'text-ink' : 'text-subtle hover:text-ink',
              )}
              onClick={() => onSelect(tab.tabId)}
            >
              {tab.label}
            </button>
            {tab.kind === 'fork' ? (
              <button
                type="button"
                aria-label={t('close', { label: tab.label })}
                className={cn(iconButton, 'mr-1.5 hover:text-danger disabled:cursor-not-allowed disabled:opacity-50')}
                disabled={busy}
                onClick={() => onDelete(tab.tabId)}
              >
                <X />
              </button>
            ) : null}
          </div>
        )
      })}
      <button
        type="button"
        aria-label={t('newFork')}
        title={t('newFork')}
        className="px-3 py-2 text-subtle transition-colors hover:text-ink focus-ring-inset disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={onCreate}
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </nav>
  )
}
