'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { type KeyboardEvent, type MouseEvent, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import type { LinearIssue, LinearIssueAvailability } from '../../lib/types.ts'
import { searchMatch } from '../../lib/utils.ts'

interface LinearPanelProps {
  issues: LinearIssue[]
  availability: LinearIssueAvailability
  onAssign?: (issue: LinearIssue) => void
  onSelect: (issue: LinearIssue) => void
}

export function LinearPanel({ issues, availability, onAssign, onSelect }: LinearPanelProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'linear' })
  const [collapsed, setCollapsed] = useState(true)
  const [query, setQuery] = useState('')
  const filtered = query
    ? issues.filter(
        (issue) =>
          searchMatch(query, issue.title) || (issue.description ? searchMatch(query, issue.description) : false),
      )
    : issues
  const countLabel =
    availability === 'ready'
      ? ` (${filtered.length !== issues.length ? `${filtered.length}/` : ''}${issues.length})`
      : ''

  function selectWithKeyboard(event: KeyboardEvent<HTMLLIElement>, issue: LinearIssue): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(issue)
  }

  function stop(event: MouseEvent | KeyboardEvent): void {
    event.stopPropagation()
  }

  return (
    <div className="border-t border-line">
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2 text-xs text-muted transition-colors duration-100 hover:bg-fill focus-ring-inset"
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="font-medium">
          {t('title')}
          {countLabel}
        </span>
        {collapsed ? (
          <ChevronRight className="size-3.5" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5" aria-hidden />
        )}
      </button>
      {!collapsed ? (
        availability === 'missing_api_key' ? (
          <p className="m-0 px-4 pb-3 text-xs text-subtle">
            <Trans t={t} i18nKey="missingApiKey" components={{ code: <code className="font-mono" /> }} />
          </p>
        ) : availability === 'ready' ? (
          issues.length === 0 ? (
            <p className="m-0 px-4 pb-3 text-xs text-subtle">{t('empty')}</p>
          ) : (
            <>
              <div className="px-2 pb-1">
                <Input
                  size="sm"
                  type="text"
                  placeholder={t('searchPlaceholder')}
                  value={query}
                  onChange={(event) => setQuery(event.currentTarget.value)}
                />
              </div>
              <ul className="max-h-64 list-none overflow-y-auto px-2 pb-2 scroll-thin">
                {filtered.map((issue) => (
                  <li
                    className="mb-1 cursor-pointer rounded-md p-2 text-xs transition-colors duration-100 hover:bg-fill focus-ring"
                    onClick={() => onSelect(issue)}
                    onKeyDown={(event) => selectWithKeyboard(event, issue)}
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the whole row is the target, and a button cannot contain its nested controls
                    role="button"
                    tabIndex={0}
                    key={issue.id}
                  >
                    <div className="mb-0.5 flex items-center gap-1.5">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: issue.state.color }}
                        title={issue.state.name}
                      />
                      <a
                        href={issue.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-2xs text-accent no-underline hover:underline"
                        onClick={stop}
                        onKeyDown={stop}
                      >
                        {issue.identifier}
                      </a>
                      <span className="text-2xs text-subtle">{issue.priorityLabel}</span>
                    </div>
                    <p className="m-0 mb-1 truncate text-ink">{issue.title}</p>
                    {issue.description ? (
                      <p className="m-0 mb-1 truncate text-2xs text-subtle">{issue.description}</p>
                    ) : null}
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-2xs text-subtle">
                        {issue.team.key}
                        {issue.project ? ` · ${issue.project}` : ''}
                      </span>
                      <span onClick={stop} onKeyDown={stop} role="none">
                        {onAssign ? (
                          <Button size="xs" variant="outline" onClick={() => onAssign(issue)}>
                            {t('implement')}
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <p className="m-0 px-4 pb-3 text-xs text-subtle">{t('disabled')}</p>
        )
      ) : null}
    </div>
  )
}
