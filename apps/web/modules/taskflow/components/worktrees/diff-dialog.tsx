'use client'

import { html as diff2html } from 'diff2html'
import 'diff2html/bundles/css/diff2html.min.css'
import { ColorSchemeType } from 'diff2html/lib/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useWorktreeDiff } from '../../lib/queries/worktrees.ts'
import type { DiffDialogProps, UnpushedCommit } from '../../lib/types.ts'
import { cn, errorMessage } from '../../lib/utils.ts'
import { CursorButton } from './cursor-button.tsx'

type DiffTab = 'diff' | 'status' | 'unpushed'

export function DiffDialog({ branch, cursorUrl = null, onClose }: DiffDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'diff' })
  const { t: tc } = useTranslation('common')
  const diff = useWorktreeDiff(branch)
  const uncommitted = diff.data?.uncommitted ?? ''
  const uncommittedTruncated = diff.data?.uncommittedTruncated ?? false
  const gitStatus = diff.data?.gitStatus ?? ''
  const unpushedCommits: UnpushedCommit[] = diff.data?.unpushedCommits ?? []
  const loading = diff.isPending
  const error = diff.error ? errorMessage(diff.error) : ''
  const [activeTab, setActiveTab] = useState<DiffTab>('diff')
  const gitStatusLineCount = gitStatus ? gitStatus.split('\n').filter((line) => line.length > 0).length : 0
  const colorScheme = document.documentElement.classList.contains('light')
    ? ColorSchemeType.LIGHT
    : ColorSchemeType.DARK
  const renderedUncommitted = uncommitted
    ? diff2html(uncommitted, { outputFormat: 'line-by-line', colorScheme, drawFileList: false })
    : ''
  const hasContent = Boolean(uncommitted) || gitStatusLineCount > 0 || unpushedCommits.length > 0
  const tabs: Array<{ id: DiffTab; label: string; disabled: boolean }> = [
    { id: 'diff', label: t('currentDiff'), disabled: !uncommitted },
    { id: 'status', label: t('gitStatus', { count: gitStatusLineCount }), disabled: gitStatusLineCount === 0 },
    { id: 'unpushed', label: t('unpushed', { count: unpushedCommits.length }), disabled: unpushedCommits.length === 0 },
  ]

  // Open on the first tab that has something in it.
  useEffect(() => {
    if (!diff.data) return
    setActiveTab(diff.data.uncommitted ? 'diff' : diff.data.gitStatus ? 'status' : 'unpushed')
  }, [diff.data])

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      className="w-[min(96vw,90rem)]"
      title={
        <span className="flex flex-wrap items-center gap-3">
          <span>
            {t('title')} — <span className="font-mono text-sm">{branch}</span>
          </span>
          {cursorUrl ? <CursorButton url={cursorUrl} /> : null}
        </span>
      }
      footer={
        <Button size="sm" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
      {loading ? (
        <div className="py-8 text-center text-sm text-subtle">{t('loading')}</div>
      ) : error ? (
        <ErrorBox error={error} />
      ) : !hasContent ? (
        <div className="py-8 text-center text-sm text-subtle">{t('empty')}</div>
      ) : (
        <>
          <div className="mb-3 inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-2 p-0.5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={activeTab === tab.id}
                className={cn(
                  'h-6 rounded-sm px-2 text-xs font-medium transition-colors duration-100 focus-ring disabled:opacity-40',
                  activeTab === tab.id
                    ? 'bg-surface text-ink shadow-raised ring-1 ring-line'
                    : 'text-subtle hover:text-ink',
                )}
                disabled={tab.disabled}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {activeTab === 'diff' && uncommitted ? (
            <div className="diff-container overflow-auto rounded-md border border-line">
              {uncommittedTruncated ? <div className="px-3 py-1 text-2xs text-warn">{t('truncated')}</div> : null}
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: diff2html escapes and renders the API diff payload */}
              <div dangerouslySetInnerHTML={{ __html: renderedUncommitted }} />
            </div>
          ) : activeTab === 'status' && gitStatusLineCount > 0 ? (
            <div className="overflow-auto rounded-md border border-line">
              <div className="border-b border-line bg-surface-2 px-3 py-2 font-mono text-2xs text-subtle">
                git status --short
              </div>
              <pre className="git-status-output">{gitStatus}</pre>
            </div>
          ) : activeTab === 'unpushed' && unpushedCommits.length > 0 ? (
            <ul className="m-0 list-none overflow-auto rounded-md border border-line p-0">
              {unpushedCommits.map((commit) => (
                <li
                  className="flex items-baseline gap-2 border-b border-line px-3 py-1.5 last:border-b-0"
                  key={commit.hash}
                >
                  <code className="shrink-0 font-mono text-2xs text-accent">{commit.hash}</code>
                  <span className="text-xs text-ink">{commit.message}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Dialog>
  )
}
