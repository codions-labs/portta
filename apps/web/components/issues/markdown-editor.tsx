'use client'

import {
  Bold,
  Braces,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils.ts'
import { iconButton } from '../ui/surfaces.ts'
import { MarkdownView } from './markdown-view.tsx'

type Command = { before: string; after?: string; fallback?: string; line?: boolean }

export function MarkdownEditor({
  value,
  onChange,
  onEscape,
  onSubmit,
  placeholder,
  disabled,
  autoFocus = false,
  compact = false,
}: {
  value: string
  onChange: (value: string) => void
  onEscape?: () => void
  onSubmit?: () => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation('issues')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const area = useRef<HTMLTextAreaElement>(null)

  const apply = ({ before, after = '', fallback = '', line = false }: Command) => {
    const node = area.current
    const start = node?.selectionStart ?? value.length
    const end = node?.selectionEnd ?? value.length
    let selected = value.slice(start, end) || fallback
    let from = start
    let to = end
    if (line) {
      from = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const newline = value.indexOf('\n', end)
      to = newline < 0 ? value.length : newline
      selected = value.slice(from, to) || fallback
      selected = selected
        .split('\n')
        .map((entry) => `${before}${entry}`)
        .join('\n')
      before = ''
    }
    const next = `${value.slice(0, from)}${before}${selected}${after}${value.slice(to)}`
    onChange(next)
    requestAnimationFrame(() => {
      node?.focus()
      const selectionStart = from + before.length
      node?.setSelectionRange(selectionStart, selectionStart + selected.length)
    })
  }

  const controls: Array<{ title: string; icon: typeof Bold; command: Command }> = [
    {
      title: t('markdown.heading1'),
      icon: Heading1,
      command: { before: '# ', line: true, fallback: t('markdown.heading') },
    },
    {
      title: t('markdown.heading2'),
      icon: Heading2,
      command: { before: '## ', line: true, fallback: t('markdown.heading') },
    },
    {
      title: t('markdown.heading3'),
      icon: Heading3,
      command: { before: '### ', line: true, fallback: t('markdown.heading') },
    },
    { title: t('markdown.bold'), icon: Bold, command: { before: '**', after: '**', fallback: t('markdown.bold') } },
    { title: t('markdown.italic'), icon: Italic, command: { before: '_', after: '_', fallback: t('markdown.italic') } },
    { title: t('markdown.strike'), icon: Strikethrough, command: { before: '~~', after: '~~' } },
    { title: t('markdown.code'), icon: Code2, command: { before: '`', after: '`', fallback: 'code' } },
    { title: t('markdown.codeBlock'), icon: Braces, command: { before: '```\n', after: '\n```', fallback: 'code' } },
    {
      title: t('markdown.link'),
      icon: Link,
      command: { before: '[', after: '](https://)', fallback: t('markdown.linkText') },
    },
    { title: t('markdown.quote'), icon: Quote, command: { before: '> ', line: true } },
    { title: t('markdown.list'), icon: List, command: { before: '- ', line: true } },
    { title: t('markdown.orderedList'), icon: ListOrdered, command: { before: '1. ', line: true } },
    { title: t('markdown.check'), icon: CheckSquare, command: { before: '- [ ] ', line: true } },
  ]

  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface transition-colors duration-100 focus-within:border-accent">
      <div className="flex min-h-9 flex-wrap items-center gap-0.5 border-b border-line bg-surface-2/60 px-1.5">
        <button type="button" className={tab(mode === 'edit')} onClick={() => setMode('edit')}>
          {t('markdown.edit')}
        </button>
        <button type="button" className={tab(mode === 'preview')} onClick={() => setMode('preview')}>
          {t('markdown.preview')}
        </button>
        {mode === 'edit' ? <span className="mx-1.5 h-4 w-px bg-line" aria-hidden /> : null}
        {mode === 'edit'
          ? controls.map(({ title, icon: Icon, command }) => (
              <button
                key={title}
                type="button"
                title={title}
                aria-label={title}
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(command)}
                className={cn(iconButton, 'disabled:pointer-events-none disabled:opacity-40')}
              >
                <Icon aria-hidden />
              </button>
            ))
          : null}
      </div>
      {mode === 'preview' ? (
        <div className={compact ? 'min-h-20 px-3 py-2' : 'min-h-32 px-3 py-2.5'}>
          {value.trim() ? <MarkdownView source={value} /> : <p className="text-sm text-subtle">{placeholder}</p>}
        </div>
      ) : (
        <textarea
          ref={area}
          data-task-markdown
          value={value}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: the caller asks for the caret when the editor opens inside a dialog
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && onEscape) {
              event.preventDefault()
              event.stopPropagation()
              onEscape()
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSubmit) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder={placeholder}
          rows={compact ? 4 : 9}
          className={cn(
            'block w-full resize-y bg-transparent font-mono text-xs leading-relaxed text-ink outline-none placeholder:text-faint disabled:opacity-50',
            compact ? 'min-h-20 px-3 py-2' : 'min-h-32 px-3 py-2.5',
          )}
        />
      )}
    </div>
  )
}

function tab(active: boolean): string {
  return cn(
    'relative flex h-9 items-center rounded-t-sm px-2 text-sm font-medium transition-colors duration-100 focus-ring-inset',
    'after:absolute after:inset-x-1.5 after:bottom-0 after:h-0.5 after:rounded-full',
    active ? 'text-ink after:bg-accent' : 'text-subtle hover:text-ink after:bg-transparent',
  )
}
