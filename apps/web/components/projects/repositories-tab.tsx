'use client'

// The repositories a Project registered, and the three ways to add one.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Project, Repository } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { RepositoryRow } from '@/components/entities/repository-row'
import { Empty, ErrorBox, Loading } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input, Select } from '@/components/ui/field'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useDiscoveredRepositories } from '@/lib/queries'
import { cn } from '@/lib/utils'

export function RepositoriesTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const { t: tr } = useTranslation('repositories')
  const [attaching, setAttaching] = useState(false)
  const mayManage = useCan('repository:manage', project.id) && !readOnly
  return (
    <>
      <Card>
        <CardHeader
          title={t('repositoriesCard.title')}
          description={t('repositoriesCard.description')}
          actions={
            mayManage ? (
              <Button size="sm" onClick={() => setAttaching(true)}>
                <Plus />
                {tr('add.button')}
              </Button>
            ) : undefined
          }
        />
        {project.repositories.length === 0 ? (
          <Empty title={t('repositoriesCard.empty')} hint={t('repositoriesCard.emptyHint')} />
        ) : (
          project.repositories.map((repository) => (
            <RepositoryRow
              key={repository.id}
              repository={repository}
              projectSlug={project.slug}
              density="card"
              actions={mayManage ? <RemoveRepository repository={repository} /> : undefined}
            />
          ))
        )}
      </Card>
      {attaching ? <RepositoriesDialog project={project} open onOpenChange={setAttaching} /> : null}
    </>
  )
}

function RemoveRepository({ repository }: { repository: Repository }) {
  const { t } = useTranslation('projects')
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: () => api.deleteRepository(repository.id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: keys.projects() }),
  })
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={remove.isPending}
      title={t('repositoriesCard.remove')}
      onClick={() => remove.mutate()}
    >
      {t('repositoriesCard.remove')}
    </Button>
  )
}

type AddTab = 'discovered' | 'manual'

/**
 * Two ways to add a repository: one the host already scanned, or one named by
 * hand. Both become the same row; the scan fills in the Git facts on its next
 * pass, and the remote is what says which forge it is (ADR 0018) — there is no
 * third tab listing what an App was granted, because there is no App.
 */
function RepositoriesDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('repositories', { keyPrefix: 'add' })
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<AddTab>('discovered')
  const [name, setName] = useState('')
  const [localPath, setLocalPath] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [role, setRole] = useState('')
  const discovered = useDiscoveredRepositories(open && tab === 'discovered')

  const create = useMutation({
    mutationFn: (body: Parameters<typeof api.createRepository>[1]) => api.createRepository(project.slug, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      void queryClient.invalidateQueries({ queryKey: keys.discoveredRepositories() })
      onOpenChange(false)
    },
  })

  const roleValue = role === '' ? null : role

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('title', { name: project.name })}
      description={t('description')}
      footer={
        tab === 'manual' ? (
          <Button
            variant="primary"
            size="sm"
            disabled={create.isPending || name.trim() === ''}
            onClick={() =>
              create.mutate({
                name: name.trim(),
                role: roleValue,
                localPath: localPath.trim() === '' ? null : localPath.trim(),
                remoteUrl: remoteUrl.trim() === '' ? null : remoteUrl.trim(),
              })
            }
          >
            {t('add')}
          </Button>
        ) : null
      }
    >
      <div
        role="tablist"
        aria-label={t('title', { name: project.name })}
        className="mb-3 flex gap-0.5 border-b border-line"
      >
        {(['discovered', 'manual'] as AddTab[]).map((entry) => (
          <button
            key={entry}
            role="tab"
            type="button"
            aria-selected={tab === entry}
            onClick={() => setTab(entry)}
            className={cn(
              'relative flex h-9 items-center px-2.5 text-sm font-medium transition-colors duration-100 focus-ring-inset',
              'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full',
              tab === entry ? 'text-ink after:bg-accent' : 'text-subtle after:bg-transparent hover:text-ink',
            )}
          >
            {t(`tabs.${entry}`)}
          </button>
        ))}
      </div>
      {create.error ? <ErrorBox error={create.error} /> : null}

      {tab === 'discovered' ? (
        discovered.isPending ? (
          <Loading label={t('discovered.reading')} />
        ) : discovered.error ? (
          <Empty title={t('discovered.unavailable')} />
        ) : (discovered.data ?? []).length === 0 ? (
          <Empty title={t('discovered.empty')} hint={t('discovered.emptyHint')} />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {(discovered.data ?? []).map((candidate) => (
              <li key={candidate.key} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="font-medium text-ink">{candidate.name}</span>
                <Mono kind="path" tone="subtle" className="flex-1 text-xs" title={candidate.path}>
                  {candidate.relativePath ?? candidate.path}
                </Mono>
                {candidate.location ? <Badge tone="outline">{candidate.location}</Badge> : null}
                {candidate.environments.map((environment) => (
                  <Badge key={environment} tone="neutral">
                    {environment}
                  </Badge>
                ))}
                <Button size="sm" disabled={create.isPending} onClick={() => create.mutate({ scanKey: candidate.key })}>
                  {t('add')}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === 'manual' ? (
        <div className="space-y-3">
          <Field label={t('manual.name')}>
            {(id) => (
              <Input
                id={id}
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-label={t('manual.name')}
              />
            )}
          </Field>
          <Field label={t('manual.localPath')} hint={t('manual.localPathHint')}>
            {(id) => (
              <Input
                id={id}
                mono
                value={localPath}
                onChange={(event) => setLocalPath(event.target.value)}
                placeholder="/srv/projects/shop/api"
                aria-label={t('manual.localPath')}
              />
            )}
          </Field>
          <Field label={t('manual.remoteUrl')}>
            {(id) => (
              <Input
                id={id}
                mono
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                placeholder="git@github.com:acme/api.git"
                aria-label={t('manual.remoteUrl')}
              />
            )}
          </Field>
          <Field label={t('manual.role')}>
            {(id) => (
              <Select
                id={id}
                value={role}
                onChange={(event) => setRole(event.target.value)}
                aria-label={t('manual.role')}
                className="w-full"
              >
                <option value="">{t('role.none')}</option>
                {['api', 'web', 'mobile', 'services', 'infra', 'docs', 'other'].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}
    </Dialog>
  )
}
