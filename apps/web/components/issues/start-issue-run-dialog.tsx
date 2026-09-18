'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { Issue, Project } from 'portta-contracts'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Callout } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { keys } from '@/lib/queries'
import { proposedBranchForIssue } from './issue-run.ts'

export function StartIssueRunDialog({
  project,
  issue,
  open,
  onOpenChange,
}: {
  project: Project
  issue: Issue
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('issues')
  const router = useRouter()
  const context = useQuery({
    queryKey: keys.issueRunContext(project.slug, issue.ref),
    queryFn: () => api.issueRunContext(project.slug, issue.ref),
    enabled: open,
    retry: false,
  })
  const [type, setType] = useState('fix')
  const [harness, setHarness] = useState('')
  const [branch, setBranch] = useState('')

  useEffect(() => {
    if (!context.data) return
    setType(context.data.defaultType)
    setHarness(context.data.defaultAgentId ?? context.data.agents[0]?.id ?? '')
    setBranch(proposedBranchForIssue(context.data.branchPattern, issue.title, context.data.defaultType))
  }, [context.data, issue.title])

  const start = useMutation({
    mutationFn: () =>
      api.startIssueRun(project.slug, issue.ref, {
        harness,
        type,
        branch: branch.trim(),
      }),
    onSuccess: (result) => {
      onOpenChange(false)
      router.push(`/projects/${encodeURIComponent(project.slug)}/runs/${encodeURIComponent(result.runId)}`)
    },
  })

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('run.title')}
      description={t('run.description')}
      footer={
        <Button
          variant="primary"
          size="sm"
          busy={start.isPending}
          disabled={!context.data?.available || harness === '' || branch.trim() === ''}
          onClick={() => start.mutate()}
        >
          {t('run.submit')}
        </Button>
      }
    >
      <div className="space-y-3">
        {start.error ? (
          <Callout tone="danger">{start.error instanceof Error ? start.error.message : String(start.error)}</Callout>
        ) : null}
        {context.isError ? <Callout tone="danger">{t('run.unavailable')}</Callout> : null}
        {context.data && !context.data.available ? <Callout tone="warn">{t('run.unavailable')}</Callout> : null}
        <Field label={t('run.agent')} required>
          {(id) => (
            <Select
              id={id}
              value={harness}
              onChange={(event) => setHarness(event.target.value)}
              disabled={!context.data?.available}
            >
              {(context.data?.agents ?? []).map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('run.type')}>
          {(id) => (
            <Select
              id={id}
              value={type}
              onChange={(event) => {
                const next = event.target.value
                setType(next)
                if (context.data) setBranch(proposedBranchForIssue(context.data.branchPattern, issue.title, next))
              }}
            >
              {(context.data?.types ?? ['fix']).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('run.branch')}
          hint={t('run.branchHint', { pattern: context.data?.branchPattern ?? '{type}/{slug}' })}
        >
          {(id) => <Input id={id} value={branch} mono onChange={(event) => setBranch(event.target.value)} />}
        </Field>
      </div>
    </Dialog>
  )
}
