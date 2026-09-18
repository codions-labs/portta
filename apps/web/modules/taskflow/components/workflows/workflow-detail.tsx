'use client'

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import type { WorkflowDefinition } from '../../lib/types.ts'
import { workflowTitle } from '../../lib/workflow-catalog.ts'

interface WorkflowDetailProps {
  workflow: WorkflowDefinition
  /** Absent for somebody who may not start a Run here. */
  onStart?: (workflowId: string) => void
}

export function WorkflowDetail({ workflow, onStart }: WorkflowDetailProps) {
  const { t } = useTranslation('taskflow-runs')
  const { t: tw } = useTranslation('taskflow-runs', { keyPrefix: 'workflows.detail' })
  const { t: tc } = useTranslation('common')
  const runtimeDefault = tw('runtimeDefault')
  return (
    <section className="min-h-0 flex-1 overflow-y-auto bg-surface scroll-thin">
      <header className="border-b border-line px-5 py-5 md:px-8">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-2xs uppercase tracking-wide text-subtle">
              <span>{t(`workflows.origin.${workflow.origin}`)}</span>
              <span>·</span>
              <span>{workflow.name}</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-ink">{workflowTitle(workflow.name)}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{workflow.description}</p>
          </div>
          {onStart ? (
            <Button
              variant="primary"
              disabled={workflow.availability === 'unavailable'}
              onClick={() => onStart(workflow.id)}
            >
              {tw('start')}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-6 p-5 md:p-8 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          {workflow.whenToUse ? (
            <section>
              <h2 className="text-sm font-semibold text-ink">{tw('whenToUse')}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{workflow.whenToUse}</p>
            </section>
          ) : null}
          <section>
            <h2 className="text-sm font-semibold text-ink">{tw('phases')}</h2>
            <div className="mt-3 space-y-2">
              {workflow.phases.length > 0 ? (
                workflow.phases.map((phase, index) => (
                  <article className="flex gap-3 rounded-lg border border-line bg-surface p-4" key={phase.key}>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-subtle">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-medium text-ink">{phase.label}</h3>
                      {phase.detail ? <p className="mt-1 text-xs leading-5 text-subtle">{phase.detail}</p> : null}
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded-lg border border-line bg-surface p-4 text-xs text-subtle">{tw('noPhases')}</p>
              )}
            </div>
          </section>
          {workflow.availability === 'unavailable' ? (
            <section className="rounded-lg border border-danger/35 bg-danger/6 p-4">
              <h2 className="text-sm font-semibold text-danger">{tw('unavailable')}</h2>
              {workflow.diagnostics.map((diagnostic) => (
                <p className="mt-2 text-xs text-danger" key={diagnostic}>
                  {diagnostic}
                </p>
              ))}
            </section>
          ) : null}
        </div>
        <aside className="space-y-4">
          <Card>
            <CardHeader title={tw('executionDefaults')} />
            <CardBody>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{tw('provider')}</dt>
                  <dd className="text-right text-ink">{workflow.defaultProvider ?? runtimeDefault}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{tw('model')}</dt>
                  <dd className="text-right text-ink">{workflow.defaultModel ?? runtimeDefault}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{tw('sandbox')}</dt>
                  <dd className="text-right text-ink">{workflow.defaultSandbox ?? runtimeDefault}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={tw('workspacePolicy')} />
            <CardBody>
              <dl className="space-y-3 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{tw('default')}</dt>
                  <dd className="text-right text-ink">{t(`strategy.${workflow.workspace.default}`)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">{tw('allowed')}</dt>
                  <dd className="mt-1 text-ink">
                    {workflow.workspace.allowed.map((value) => t(`strategy.${value}`)).join(', ')}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-subtle">{tw('mutatesRepository')}</dt>
                  <dd className="text-ink">{workflow.workspace.mutatesRepository ? tc('yes') : tc('no')}</dd>
                </div>
                {workflow.workspace.reason ? (
                  <div>
                    <dt className="text-subtle">{tw('reason')}</dt>
                    <dd className="mt-1 leading-5 text-ink">{workflow.workspace.reason}</dd>
                  </div>
                ) : null}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={tw('source')} />
            <CardBody>
              <p className="break-all font-mono text-xs text-ink">{workflow.path}</p>
              <p className="mt-2 break-all font-mono text-2xs text-subtle">{workflow.contentHash}</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </section>
  )
}
