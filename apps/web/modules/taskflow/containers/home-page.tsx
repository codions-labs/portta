'use client'

// `/taskflow`: the directories the host daemon serves, the Portta Project each
// one is, and the way to add or remove one.

import { useQueryClient } from '@tanstack/react-query'
import { FolderGit2, Loader2, Plus } from 'lucide-react'
import Link from 'next/link'
import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CodeChip, Mono } from '@/components/copy'
import { Empty, ErrorBox, PageHeader, SkeletonRows } from '@/components/shell-bits'
import { StatusIndicator } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { Table, Td, Th, Tr } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { useCan } from '@/lib/permissions'
import { removeProject, setUpProject } from '../lib/api/index.ts'
import { taskflowPaths } from '../lib/navigation.ts'
import { useProjectInitPhaseLabel, useProjectSetupErrorMessage } from '../lib/phase-labels.ts'
import { findTaskflowProject } from '../lib/project-match.ts'
import { registryKeys, useTaskflowProjects } from '../lib/queries/projects.ts'
import type { ProjectInitPhase, ProjectSummary } from '../lib/types.ts'

export interface PorttaProjectDirectories {
  id: string
  slug: string
  name: string
  hostPaths: string[]
}

export function TaskflowHomePage({ projects }: { projects: readonly PorttaProjectDirectories[] }) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'home' })
  const registry = useTaskflowProjects()
  const canCreate = useCan('project:create')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ProjectSummary | null>(null)
  const ownerOf = (entry: ProjectSummary) =>
    projects.find((candidate) => findTaskflowProject([entry], candidate.hostPaths) !== null) ?? null

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canCreate ? (
            <Button size="md" variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t('add')}
            </Button>
          ) : undefined
        }
      />
      {registry.error ? (
        <ErrorBox error={registry.error} />
      ) : (
        <Card>
          {registry.isPending ? (
            <SkeletonRows rows={3} />
          ) : registry.data.length === 0 ? (
            <Empty icon={FolderGit2} title={t('empty')} hint={t('emptyHint')} />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t('columns.name')}</Th>
                  <Th>{t('columns.path')}</Th>
                  <Th>{t('columns.prefix')}</Th>
                  <Th>{t('columns.project')}</Th>
                  <Th>{t('columns.state')}</Th>
                  <Th>
                    <span className="sr-only">{t('remove')}</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {registry.data.map((entry) => (
                  <RegistryRow
                    key={entry.prefix}
                    entry={entry}
                    owner={ownerOf(entry)}
                    onRemove={() => setRemoving(entry)}
                  />
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
      <AddDirectoryDialog open={adding} onOpenChange={setAdding} />
      <RemoveDirectoryDialog
        entry={removing}
        owner={removing ? ownerOf(removing) : null}
        onClose={() => setRemoving(null)}
      />
    </>
  )
}

function RegistryRow({
  entry,
  owner,
  onRemove,
}: {
  entry: ProjectSummary
  owner: PorttaProjectDirectories | null
  onRemove: () => void
}) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'home' })
  // Removing a registration is about the Project it serves; one no Project claims is for somebody who sees them all.
  const canRemove = useCan('project:delete', owner ? owner.id : null)
  return (
    <Tr>
      <Td className="font-medium text-ink">{entry.name}</Td>
      <Td>
        <Mono kind="path">{entry.path}</Mono>
      </Td>
      <Td>
        <CodeChip tone="muted">{entry.prefix}</CodeChip>
      </Td>
      <Td>
        {owner ? (
          <Link
            href={taskflowPaths(owner.slug).worktrees()}
            className="text-accent hover:underline focus-ring"
            title={t('open')}
          >
            {owner.name}
          </Link>
        ) : (
          <span className="text-subtle">{t('noProject')}</span>
        )}
      </Td>
      <Td>
        <StatusIndicator tone={entry.active ? 'ok' : 'neutral'}>
          {entry.active ? t('active') : t('idle')}
        </StatusIndicator>
      </Td>
      <Td className="text-right">
        {canRemove ? (
          <Button size="xs" variant="ghost" onClick={onRemove}>
            {t('remove')}
          </Button>
        ) : null}
      </Td>
    </Tr>
  )
}

function AddDirectoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'home' })
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const toast = useToast()
  const phaseLabel = useProjectInitPhaseLabel()
  const setupErrorMessage = useProjectSetupErrorMessage()
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<ProjectInitPhase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const formId = 'taskflow-add-directory'

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    const target = path.trim()
    if (!target || busy) return
    setBusy(true)
    setError(null)
    setPhase(null)
    try {
      await setUpProject(target, setPhase)
      await queryClient.invalidateQueries({ queryKey: registryKeys.projects() })
      toast.push({ tone: 'ok', title: t('added') })
      setPath('')
      onOpenChange(false)
    } catch (caught) {
      setError(setupErrorMessage(caught))
    } finally {
      setBusy(false)
      setPhase(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('addTitle')}
      footer={
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" form={formId} busy={busy} disabled={path.trim() === ''}>
            {tc('add')}
          </Button>
        </>
      }
    >
      <form id={formId} className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
        <Field label={t('path')} hint={t('addHint')} id={`${formId}-path`}>
          <Input
            id={`${formId}-path`}
            mono
            autoFocus
            placeholder="/home/you/code/shop"
            value={path}
            disabled={busy}
            onChange={(event) => setPath(event.currentTarget.value)}
          />
        </Field>
        {busy && phase ? (
          <span className="flex items-center gap-1.5 text-xs text-subtle" role="status">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {phaseLabel(phase)}
          </span>
        ) : null}
        {error ? <ErrorBox error={error} /> : null}
      </form>
    </Dialog>
  )
}

function RemoveDirectoryDialog({
  entry,
  owner,
  onClose,
}: {
  entry: ProjectSummary | null
  owner: PorttaProjectDirectories | null
  onClose: () => void
}) {
  const { t } = useTranslation('taskflow', { keyPrefix: 'home' })
  const queryClient = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function confirm(): Promise<void> {
    if (!entry) return
    setBusy(true)
    setError(undefined)
    try {
      await removeProject(entry.prefix)
      await queryClient.invalidateQueries({ queryKey: registryKeys.projects() })
      toast.push({ tone: 'ok', title: t('removed') })
      onClose()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open={entry !== null}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      title={t('removeTitle')}
      impact={t('removeImpact', { path: entry?.path ?? '' })}
      details={owner ? owner.name : undefined}
      confirmLabel={t('remove')}
      busy={busy}
      error={error}
      onConfirm={() => void confirm()}
    />
  )
}
