'use client'

import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'

export interface BreadcrumbItem {
  label: string
  /** Where the crumb goes; the last item never has one. */
  href?: string
  /** The name is still loading: shown, but dimmed. */
  pending?: boolean
}

/**
 * Where a page sits: Projects › project › Repositories › api. The tab is never a
 * crumb; the last item is the entity the page is about. On a narrow screen
 * only the parent and the current item stay visible.
 */
export function Breadcrumb({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  const { t } = useTranslation('common')
  if (items.length < 2) return null
  return (
    <nav aria-label={t('breadcrumb')} className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-0.5 overflow-hidden text-xs text-subtle whitespace-nowrap">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li
              key={`${index}-${item.label}`}
              className={cn('flex min-w-0 items-center gap-0.5', index < items.length - 2 && 'hidden sm:flex')}
            >
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  // The parent's separator would lead the trail once the items before it are hidden.
                  className={cn(
                    'size-3 shrink-0 text-faint',
                    index === items.length - 2 && items.length > 2 && 'hidden sm:block',
                  )}
                />
              ) : null}
              {last ? (
                <span aria-current="page" title={item.label} className="max-w-64 truncate rounded-xs px-1 text-muted">
                  {item.label}
                </span>
              ) : item.href ? (
                <a
                  href={item.href}
                  title={item.label}
                  className={cn(
                    'max-w-48 truncate rounded-xs px-1 transition-colors duration-100 hover:bg-fill hover:text-ink focus-ring',
                    item.pending && 'opacity-60',
                  )}
                >
                  {item.label}
                </a>
              ) : (
                <span className="truncate px-1">{item.label}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
