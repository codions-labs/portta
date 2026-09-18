'use client'

// Between a Portta Project's page and Taskflow: find the Taskflow Project it
// is, or offer to make it one.
//
// The registry is the daemon's, so the answer arrives after the page does.
// Until it has, nothing below here renders: every page under it is about a
// prefix, and a request made without one would be a 404 about nothing.

import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Loader2, PlugZap } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Callout, Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/field'
import { useCan } from '@/lib/permissions'
import { createProjectApi, setUpProject } from '../../lib/api/index.ts'
import { useProjectInitPhaseLabel, useProjectSetupErrorMessage } from '../../lib/phase-labels.ts'
import { TaskflowProjectProvider } from '../../lib/project.tsx'
import { findTaskflowProject } from '../../lib/project-match.ts'
import { registryKeys, useTaskflowProjects } from '../../lib/queries/projects.ts'
import type { ProjectInitPhase } from '../../lib/types.ts'
import { TaskflowWorkspace } from './workspace.tsx'

export interface TaskflowProjectGateProps {
  slug: string
  projectId: string
  /** The Project's directories on the host, as the server resolved them. */
  hostPaths: readonly string[]
  children: ReactNode
}

export function TaskflowProjectGate({ slug, projectId, hostPaths, children }: TaskflowProjectGateProps) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'gate' })
  const projects = useTaskflowProjects()
  const match = projects.data ? findTaskflowProject(projects.data, hostPaths) : null
  const api = useMemo(() => (match ? createProjectApi(match.prefix) : null), [match])

  if (projects.isPending) return <Loading label={t('loading')} />
  if (projects.error) {
    return (
      <div className="flex flex-col gap-3">
        <ErrorBox error={projects.error} />
        <Callout tone="neutral" icon={<PlugZap />} title={t('unreachable')}>
          {t('unreachableHint')}
        </Callout>
      </div>
    )
  }
  if (!api) return <AddToTaskflow projectId={projectId} hostPaths={hostPaths} />

  return (
    <TaskflowProjectProvider slug={slug} projectId={projectId} api={api}>
      <TaskflowWorkspace>{children}</TaskflowWorkspace>
    </TaskflowProjectProvider>
  )
}

function AddToTaskflow({ projectId, hostPaths }: { projectId: string; hostPaths: readonly string[] }) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'gate' })
  const queryClient = useQueryClient()
  const phaseLabel = useProjectInitPhaseLabel()
  const setupErrorMessage = useProjectSetupErrorMessage()
  const canAdd = useCan('project:create', projectId)
  const [path, setPath] = useState(hostPaths[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<ProjectInitPhase | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (hostPaths.length === 0) {
    return <Empty icon={FolderGit2} title={t('noDirectory')} hint={t('noDirectoryHint')} />
  }

  async function add(): Promise<void> {
    setBusy(true)
    setError(null)
    setPhase(null)
    try {
      await setUpProject(path, setPhase)
      await queryClient.invalidateQueries({ queryKey: registryKeys.projects() })
    } catch (caught) {
      setError(setupErrorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Empty
      icon={FolderGit2}
      title={t('missing')}
      hint={t('missingHint')}
      action={
        canAdd ? (
          <div className="flex flex-col items-center gap-2">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {hostPaths.length > 1 ? (
                <Select
                  size="sm"
                  aria-label={t('directory')}
                  value={path}
                  onChange={(event) => setPath(event.target.value)}
                >
                  {hostPaths.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </Select>
              ) : (
                <Mono kind="path">{path}</Mono>
              )}
              <Button size="sm" variant="primary" busy={busy} onClick={() => void add()}>
                {t('add')}
              </Button>
            </div>
            {busy && phase ? (
              <span className="flex items-center gap-1 text-xs text-subtle" role="status">
                <Loader2 aria-hidden className="size-3 animate-spin" />
                {phaseLabel(phase)}
              </span>
            ) : null}
            {error ? <ErrorBox error={error} /> : null}
          </div>
        ) : (
          <span className="text-xs text-subtle">{t('notAllowed')}</span>
        )
      }
    />
  )
}
