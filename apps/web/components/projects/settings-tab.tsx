'use client'

// What a Project is called, where its files are, and removing the grouping.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import type { Project } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mono } from '@/components/copy'
import { Empty, ErrorBox } from '@/components/shell-bits'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input, Select } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys } from '@/lib/queries'

export function SettingsTab({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const { t } = useTranslation('projects')
  const { t: tc } = useTranslation('common')
  const queryClient = useQueryClient()
  const router = useRouter()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [relativePath, setRelativePath] = useState(project.relativePath ?? '')
  const [archived, setArchived] = useState(project.archived)
  // Null is "derive it", which is what a Project with a GitHub remote wants and
  // is why the control has three states rather than two.
  const [taskProvider, setTaskProvider] = useState<'derived' | 'github' | 'linear'>(project.taskProvider ?? 'derived')
  const [linearTeam, setLinearTeam] = useState(project.linearTeam ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [typed, setTyped] = useState('')

  const mayEdit = useCan('project:update', project.id) && !readOnly
  const mayDelete = useCan('project:delete', project.id) && !readOnly

  const save = useMutation({
    mutationFn: () =>
      api.patchProject(project.slug, {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        relativePath: relativePath.trim() === '' ? null : relativePath.trim(),
        archived,
        taskProvider: taskProvider === 'derived' ? null : taskProvider,
        linearTeam: linearTeam.trim() === '' ? null : linearTeam.trim(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      router.refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => api.deleteProject(project.slug),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      router.push('/projects')
    },
  })

  // A page with nothing on it is worse than one that says why.
  if (!mayEdit && !mayDelete) {
    return (
      <Card>
        <Empty title={t('settings.title')} hint={t('settings.description')} />
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {mayEdit ? (
        <Card>
          <CardHeader title={t('settings.title')} description={t('settings.description')} />
          <CardBody className="space-y-3">
            {save.error ? <ErrorBox error={save.error} /> : null}
            <Field label={t('create.name')}>
              {(id) => (
                <Input
                  id={id}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-label={t('create.name')}
                />
              )}
            </Field>
            <Field label={t('create.descriptionLabel')}>
              {(id) => (
                <Input
                  id={id}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  aria-label={t('create.descriptionLabel')}
                />
              )}
            </Field>
            <Field
              label={t('settings.relativePath')}
              hint={
                <>
                  {t('settings.relativePathHint')}
                  {project.resolvedPath ? (
                    <>
                      {' '}
                      ·{' '}
                      <Mono kind="path" tone="subtle">
                        {project.resolvedPath}
                      </Mono>
                    </>
                  ) : null}
                </>
              }
            >
              {(id) => (
                <Input
                  id={id}
                  mono
                  value={relativePath}
                  onChange={(event) => setRelativePath(event.target.value)}
                  aria-label={t('settings.relativePath')}
                  placeholder={project.slug}
                />
              )}
            </Field>
            {/* Where this Project's work lives. `derived` is the default and
                needs no decision: a repository with a GitHub remote is a GitHub
                project already (ADR 0050). */}
            <Field label={t('settings.provider')} hint={t('settings.providerHint')}>
              {(id) => (
                <Select
                  id={id}
                  value={taskProvider}
                  onChange={(event) => setTaskProvider(event.target.value as typeof taskProvider)}
                  aria-label={t('settings.provider')}
                >
                  <option value="derived">{t('settings.providerDerived')}</option>
                  <option value="github">GitHub</option>
                  <option value="linear">Linear</option>
                </Select>
              )}
            </Field>
            {taskProvider === 'linear' ? (
              <Field label={t('settings.linearTeam')} hint={t('settings.linearTeamHint')}>
                {(id) => (
                  <Input
                    id={id}
                    mono
                    value={linearTeam}
                    onChange={(event) => setLinearTeam(event.target.value.toUpperCase())}
                    aria-label={t('settings.linearTeam')}
                    placeholder="ENG"
                  />
                )}
              </Field>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={archived} onCheckedChange={setArchived} aria-label={t('settings.archived')} />
              {t('settings.archived')}
            </label>
            <Button
              size="sm"
              variant="primary"
              disabled={save.isPending || name.trim() === ''}
              onClick={() => save.mutate()}
            >
              {tc('save')}
            </Button>
          </CardBody>
        </Card>
      ) : null}
      {mayDelete ? (
        <Card>
          <CardHeader title={t('settings.deleteTitle')} description={t('settings.deleteDescription')} />
          <CardBody className="space-y-3">
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
              <li>{t('settings.deleteRemoves')}</li>
              <li>{t('settings.deleteKeeps')}</li>
            </ul>
            {remove.error ? <ErrorBox error={remove.error} /> : null}
            {confirmDelete ? (
              <div className="space-y-2">
                <Field label={t('settings.typeSlug', { slug: project.slug })}>
                  {(id) => (
                    <Input
                      id={id}
                      mono
                      value={typed}
                      onChange={(event) => setTyped(event.target.value)}
                      aria-label={t('settings.typeSlug', { slug: project.slug })}
                    />
                  )}
                </Field>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={typed !== project.slug || remove.isPending}
                    onClick={() => remove.mutate()}
                  >
                    {t('settings.deleteButton')}
                  </Button>
                  <Button size="sm" onClick={() => setConfirmDelete(false)}>
                    {tc('cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                {t('settings.deleteButton')}
              </Button>
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}
