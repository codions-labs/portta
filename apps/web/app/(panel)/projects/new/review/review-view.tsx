'use client'

// What adopting a folder would do, read from the plan the host collector published.
//
// The panel runs nothing here: it shows the same report as `portta analyze`, lets somebody decide who
// may open each site, registers the project in the panel, and gives the command that adopts the folder
// in a terminal with those decisions in it.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { adoptCommand, slug as slugify } from 'portta-core/browser'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Mono } from '@/components/copy'
import { Callout, ErrorBox, Loading, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Field, Input } from '@/components/ui/field'
import { Segmented } from '@/components/ui/segmented'
import { api } from '@/lib/api'
import { keys, useFolderPlan } from '@/lib/queries'

type Choice = 'protect' | 'public' | 'later'

/** `loja-nova` becomes `Loja Nova`: a name to start from, which the person edits. */
function titleOf(path: string): string {
  const last = path.split('/').at(-1) ?? path
  return last
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(' ')
}

export function ReviewView({ path }: { path: string }) {
  const { t } = useTranslation('projects', { keyPrefix: 'review' })
  const router = useRouter()
  const queryClient = useQueryClient()
  const plan = useFolderPlan(path)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [name, setName] = useState<string | null>(null)

  const register = useMutation({
    mutationFn: (input: { name: string; slug: string }) =>
      api.createProject({ slug: input.slug, name: input.name, description: null, relativePath: path }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: keys.projects() })
      void queryClient.invalidateQueries({ queryKey: keys.discoveredFolders() })
      router.push(`/projects/${encodeURIComponent(project.slug)}`)
    },
  })

  if (plan.isPending) return <Loading />
  if (plan.isError) return <ErrorBox error={plan.error} />
  const data = plan.data
  const http = data.services.filter((service) => service.kind === 'http')
  const choiceOf = (service: string): Choice => choices[service] ?? 'later'
  const projectName = name ?? titleOf(path)
  const command = adoptCommand(path, Object.fromEntries(http.map((service) => [service.name, choiceOf(service.name)])))
  const published = data.services.filter((service) => service.publishedPorts.length > 0)

  return (
    <div className="mx-auto w-full max-w-300 min-w-0">
      <PageHeader
        title={t('heading')}
        description={t('description', { path })}
        breadcrumb={[
          { label: t('crumbProjects'), href: '/projects' },
          { label: t('crumbAdd'), href: '/projects/new' },
          { label: path.split('/').at(-1) ?? path },
        ]}
      />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title={t('services.title')}
              description={t('services.count', { count: data.services.length, file: data.composeFile })}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-subtle">
                  <tr>
                    <th className="px-5 py-2 font-medium">{t('services.service')}</th>
                    <th className="px-3 py-2 font-medium">{t('services.how')}</th>
                    <th className="px-3 py-2 font-medium">{t('services.address')}</th>
                    <th className="px-5 py-2 font-medium">{t('services.who')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.services.map((service) => {
                    const isHttp = service.kind === 'http'
                    return (
                      <tr key={service.name}>
                        <td className="px-5 py-3">
                          <b className="font-semibold text-ink">{service.name}</b>
                          <Mono kind="text" tone="subtle" className="block text-xs">
                            {service.port ? `:${service.port}` : (service.image ?? '')}
                          </Mono>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={isHttp ? 'info' : 'neutral'}>
                            {isHttp ? t('services.site') : t('services.private')}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {isHttp ? (
                            <Mono
                              kind="text"
                              tone="ink"
                              className="text-xs"
                            >{`${data.project.name}-${service.name}.${data.domain}`}</Mono>
                          ) : (
                            <span className="text-xs text-subtle">{t('services.onlyInside')}</span>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {isHttp ? (
                            <Segmented
                              label={t('services.who')}
                              value={choiceOf(service.name)}
                              onChange={(value) => setChoices((current) => ({ ...current, [service.name]: value }))}
                              options={[
                                { value: 'protect', label: t('services.password'), selectedClassName: 'text-ok' },
                                { value: 'public', label: t('services.everybody'), selectedClassName: 'text-info' },
                                { value: 'later', label: t('services.later'), selectedClassName: 'text-warn' },
                              ]}
                            />
                          ) : (
                            <span className="text-xs text-subtle">{t('services.bridge')}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('changes.title')} />
            <ul className="divide-y divide-line text-sm">
              {http.length > 0 ? (
                <Item ok>{t('changes.joins', { count: http.length, names: http.map((s) => s.name).join(', ') })}</Item>
              ) : null}
              {published.map((service) => (
                <Item ok key={`p-${service.name}`}>
                  {t('changes.port', {
                    port: service.publishedPorts.map((port) => `${port.host}:${port.container}`).join(', '),
                    service: service.name,
                  })}
                </Item>
              ))}
              {data.findings.containerNameCollisions.map((entry) => (
                <Item key={`c-${entry.service}`}>
                  {t('changes.collision', { name: entry.containerName, service: entry.service, owner: entry.usedBy })}
                </Item>
              ))}
              {data.findings.fixedContainerNames
                .filter((service) => !data.findings.containerNameCollisions.some((entry) => entry.service === service))
                .map((service) => (
                  <Item key={`f-${service}`}>{t('changes.fixedName', { service })}</Item>
                ))}
              {data.findings.namespaceInUse ? (
                <Item>{t('changes.namespaceInUse', { name: data.findings.namespaceInUse.project })}</Item>
              ) : null}
              {data.adopted ? <Item ok>{t('changes.adopted')}</Item> : null}
            </ul>
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          <Card>
            <CardBody className="space-y-3.5">
              <Field label={t('side.name')}>
                {(id) => <Input id={id} value={projectName} onChange={(event) => setName(event.currentTarget.value)} />}
              </Field>
              <Field label={t('side.environment')} hint={t('side.environmentHint', { source: data.project.source })}>
                {(id) => <Input id={id} mono readOnly value={data.project.name} />}
              </Field>
              <Callout tone="ok">{t('side.untouched', { file: data.composeFile })}</Callout>
              {register.isError ? <ErrorBox error={register.error} /> : null}
              <Button
                className="w-full"
                variant="primary"
                disabled={register.isPending || projectName.trim() === ''}
                onClick={() => register.mutate({ name: projectName.trim(), slug: slugify(projectName) })}
              >
                {t('side.register')}
              </Button>
              <p className="text-xs text-subtle">{t('side.registerHint')}</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2">
              <p className="text-sm font-semibold text-ink">{t('side.commandTitle')}</p>
              <span className="flex items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
                <span className="min-w-0 flex-1 break-all font-mono text-xs">{command}</span>
                <CopyButton
                  value={command}
                  label={t('side.copy')}
                  className="text-terminal-dim hover:text-terminal-fg"
                />
              </span>
              <p className="text-xs text-subtle">{t('side.commandHint')}</p>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function Item({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 px-5 py-3">
      {ok ? (
        <Check className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />
      ) : (
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
      )}
      <span className="min-w-0 text-muted">{children}</span>
    </li>
  )
}
