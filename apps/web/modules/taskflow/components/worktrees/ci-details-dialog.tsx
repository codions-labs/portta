'use client'

import { CheckCircle2, Circle, ExternalLink, Minus, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useTaskflowProject } from '../../lib/project.tsx'
import { normalizeTextForPrompt } from '../../lib/prompt-utils.ts'
import type { PrEntry } from '../../lib/types.ts'
import { cn, errorMessage, prLabel } from '../../lib/utils.ts'

interface CiDetailsDialogProps {
  pr: PrEntry
  branch: string
  onClose: () => void
  onFixSuccess: () => void
}

function checkKey(check: { name: string; runId: number | null }): string {
  return `${check.name}:${check.runId}`
}

function StatusIcon({ status }: { status: string }) {
  const className = cn('size-4 shrink-0', statusColor(status))
  if (status === 'success') return <CheckCircle2 aria-hidden className={className} />
  if (status === 'failed') return <XCircle aria-hidden className={className} />
  if (status === 'skipped') return <Minus aria-hidden className={className} />
  return <Circle aria-hidden className={className} />
}

function statusColor(status: string): string {
  if (status === 'success') return 'text-ok'
  if (status === 'failed') return 'text-danger'
  if (status === 'pending') return 'text-warn'
  return 'text-subtle'
}

export function CiDetailsDialog({ pr, branch, onClose, onFixSuccess }: CiDetailsDialogProps) {
  const { t } = useTranslation('taskflow-worktrees', { keyPrefix: 'ci' })
  const { api } = useTaskflowProject()
  const { t: tc } = useTranslation('common')
  const [logsByRunId, setLogsByRunId] = useState<Map<number, string>>(new Map())
  const [expandedChecks, setExpandedChecks] = useState<Set<string>>(new Set())
  const [loadingRunId, setLoadingRunId] = useState<number | null>(null)
  const [logsError, setLogsError] = useState('')
  const [fixLoading, setFixLoading] = useState(false)
  const [fixError, setFixError] = useState('')
  const toast = useToast()
  const label = prLabel(pr)

  function logsForCheck(check: { name: string; runId: number | null }): string {
    if (check.runId === null) return ''
    const logs = logsByRunId.get(check.runId)
    if (!logs) return ''
    const prefix = `${check.name}\t`
    return logs
      .split('\n')
      .filter((line) => line.startsWith(prefix))
      .map((line) => line.slice(prefix.length))
      .join('\n')
  }

  function toggleCheck(key: string): void {
    setExpandedChecks((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function viewLogs(check: { runId: number; name: string }): Promise<void> {
    const key = checkKey(check)
    if (logsByRunId.has(check.runId)) {
      toggleCheck(key)
      return
    }
    setExpandedChecks((current) => new Set(current).add(key))
    setLogsError('')
    setLoadingRunId(check.runId)
    try {
      const logs = await api.fetchCiLogs(String(check.runId))
      setLogsByRunId((current) => new Map(current).set(check.runId, logs))
    } catch (caught) {
      setLogsError(errorMessage(caught))
      setExpandedChecks((current) => {
        const next = new Set(current)
        next.delete(key)
        return next
      })
    } finally {
      setLoadingRunId(null)
    }
  }

  async function fix(checkName: string, logs: string): Promise<void> {
    if (!branch) return
    setFixError('')
    setFixLoading(true)
    // The prompt is written for the agent, not for the reader, so it stays in English.
    const preamble = `${['Fix the failing CI check.', `PR: ${label}`, `Check: ${checkName}`, '', 'Logs:'].join('\n')}\n`
    try {
      await api.sendWorktreePrompt(branch, normalizeTextForPrompt(logs), preamble)
      toast.push({ tone: 'ok', title: t('fixRequested', { check: checkName }) })
      onFixSuccess()
    } catch (caught) {
      setFixError(errorMessage(caught))
    } finally {
      setFixLoading(false)
    }
  }

  async function copy(logs: string): Promise<void> {
    await navigator.clipboard.writeText(logs)
    toast.push({ tone: 'ok', title: t('copied') })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size="lg"
      title={t('title', { pr: label })}
      footer={
        <Button size="sm" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {pr.ciChecks.map((check) => {
          const key = checkKey(check)
          const cached = check.runId !== null && logsByRunId.has(check.runId)
          const expanded = expandedChecks.has(key)
          const filtered = expanded ? logsForCheck(check) : ''
          return (
            <li className="rounded-md border border-line bg-surface p-3" key={key}>
              <div className="flex items-center gap-2">
                <StatusIcon status={check.status} />
                <span className="flex-1 truncate text-sm font-medium">{check.name}</span>
                <span className={cn('text-2xs', statusColor(check.status))}>{t(`status.${check.status}`)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                {check.status === 'failed' && check.runId !== null ? (
                  cached ? (
                    <Button size="xs" variant="link" onClick={() => toggleCheck(key)}>
                      {expanded ? t('hideLogs') : t('showLogs')}
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="link"
                      onClick={() => void viewLogs({ runId: check.runId ?? 0, name: check.name })}
                    >
                      {t('viewLogs')}
                    </Button>
                  )
                ) : null}
                {check.url ? (
                  <a
                    href={check.url}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center gap-1 text-2xs text-subtle no-underline hover:text-ink hover:underline"
                  >
                    GitHub <ExternalLink aria-hidden className="size-3" />
                  </a>
                ) : null}
              </div>
              {check.runId !== null && loadingRunId === check.runId && expanded ? (
                <div className="mt-2 py-2 text-xs text-subtle">{t('loadingLogs')}</div>
              ) : expanded && filtered ? (
                <div className="mt-2">
                  <pre className="m-0 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-surface-2 p-3 font-mono text-2xs">
                    {filtered}
                  </pre>
                  <div className="mt-1.5 flex items-center justify-end gap-2">
                    <Button size="xs" variant="link" onClick={() => void copy(filtered)}>
                      {t('copyLogs')}
                    </Button>
                    <Button
                      variant="primary"
                      size="xs"
                      busy={fixLoading}
                      disabled={!branch}
                      onClick={() => void fix(check.name, filtered)}
                    >
                      {t('askFix')}
                    </Button>
                  </div>
                </div>
              ) : null}
              {logsError && loadingRunId === null && check.runId !== null && !logsByRunId.has(check.runId) ? (
                <div className="mt-2">
                  <ErrorBox error={logsError} />
                </div>
              ) : null}
              {fixError ? (
                <div className="mt-2">
                  <ErrorBox error={fixError} />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </Dialog>
  )
}
