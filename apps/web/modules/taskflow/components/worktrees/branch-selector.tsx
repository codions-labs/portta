'use client'

import { ChevronDown, ChevronUp } from 'lucide-react'
import { type FocusEvent, type KeyboardEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import type { AvailableBranch } from '../../lib/types.ts'
import { cn, searchMatch } from '../../lib/utils.ts'

interface BranchSelectorProps {
  label: string
  selected?: string
  branches?: AvailableBranch[]
  loading?: boolean
  error?: string | null
  placeholder?: string
  initialOpen?: boolean
  disabled?: boolean
  inlineToggleLabel?: string
  inlineToggleAriaLabel?: string
  inlineToggleChecked?: boolean
  onInlineToggle?: () => void
  onSelect: (branch: string) => void
}

export function BranchSelector({
  label,
  selected = '',
  branches = [],
  loading = false,
  error = null,
  placeholder,
  initialOpen = false,
  disabled = false,
  inlineToggleLabel,
  inlineToggleAriaLabel,
  inlineToggleChecked = false,
  onInlineToggle,
  onSelect,
}: BranchSelectorProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'branchSelector' })
  const [open, setOpen] = useState(initialOpen)
  const [searchQuery, setSearchQuery] = useState('')
  const fieldRef = useRef<HTMLFieldSetElement>(null)
  const filteredBranches = searchQuery.trim()
    ? branches.filter((branch) => searchMatch(searchQuery, branch.name))
    : branches

  function close(): void {
    setOpen(false)
    setSearchQuery('')
  }

  function selectBranch(name: string): void {
    onSelect(name)
    close()
  }

  function handleBlur(event: FocusEvent<HTMLFieldSetElement>): void {
    if (event.relatedTarget instanceof Node && fieldRef.current?.contains(event.relatedTarget)) return
    close()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      if (filteredBranches[0]) selectBranch(filteredBranches[0].name)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return (
    <fieldset ref={fieldRef} onBlur={handleBlur} className="m-0 border-0 p-0">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <button
        type="button"
        disabled={disabled}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-2.5 text-left text-sm text-ink',
          'transition-colors duration-100 hover:border-line-strong focus-ring',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line',
        )}
        aria-label={label}
        aria-expanded={disabled ? undefined : open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={selected ? 'font-mono' : 'text-faint'}>{selected || placeholder || t('placeholder')}</span>
        {!disabled ? (
          open ? (
            <ChevronUp aria-hidden className="size-3.5 text-subtle" />
          ) : (
            <ChevronDown aria-hidden className="size-3.5 text-subtle" />
          )
        ) : null}
      </button>
      {open && !disabled ? (
        <div className="mt-2 overflow-hidden rounded-md border border-line bg-surface">
          <div className="border-b border-line p-2">
            <Input
              autoFocus
              size="sm"
              type="text"
              aria-label={t('searchLabel', { label })}
              placeholder={t('searchPlaceholder')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-2xs text-subtle">
            <div className="flex min-w-0 items-center gap-2">
              {loading && filteredBranches.length === 0 ? (
                <span>{t('loadingShort')}</span>
              ) : error && filteredBranches.length === 0 ? (
                <span>{t('loadFailed')}</span>
              ) : (
                <span>
                  {t('available', {
                    count:
                      filteredBranches.length !== branches.length
                        ? `${filteredBranches.length}/${branches.length}`
                        : branches.length,
                  })}
                </span>
              )}
              {loading && filteredBranches.length > 0 ? (
                <span className="shrink-0 text-warn">{t('updating')}</span>
              ) : error && filteredBranches.length > 0 ? (
                <span className="shrink-0 text-danger">{t('updateFailed')}</span>
              ) : null}
            </div>
            {inlineToggleLabel && onInlineToggle ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="text-2xs text-subtle transition-colors hover:text-ink"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onInlineToggle}
                >
                  {inlineToggleLabel}
                </button>
                <Switch
                  checked={inlineToggleChecked}
                  size="sm"
                  aria-label={inlineToggleAriaLabel ?? inlineToggleLabel}
                  onCheckedChange={() => onInlineToggle()}
                />
              </div>
            ) : null}
          </div>
          {loading && filteredBranches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-subtle">{t('loading')}</p>
          ) : error && filteredBranches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-subtle">{t('failed', { error })}</p>
          ) : filteredBranches.length === 0 ? (
            <p className="px-3 py-2 text-xs text-subtle">{t('noMatches')}</p>
          ) : (
            <ul className="max-h-48 overflow-y-auto py-1 scroll-thin">
              {filteredBranches.map((branch) => (
                <li key={branch.name}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors duration-100 hover:bg-fill focus-ring-inset',
                      selected === branch.name && 'bg-selection',
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectBranch(branch.name)}
                  >
                    <span className="font-mono text-ink">{branch.name}</span>
                    {selected === branch.name ? <span className="text-2xs text-accent">{t('selected')}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </fieldset>
  )
}
