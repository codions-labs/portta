'use client'

// How a project gets here. The panel never mounts a project's folder (it reads
// what Docker and the host's collector say), so reading Compose files is the
// terminal's job, and this page says so instead of pretending to scan.

import { Folder, Terminal } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/copy'
import { Callout, PageHeader } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/field'
import { useEnvironments } from '@/lib/queries'
import { useDiscoveredFolders, useEnvironmentOwners } from '@/lib/queries/projects'
import { CreateProjectDialog } from '../projects-view'

function Command({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
      <span className="min-w-0 flex-1 truncate font-mono text-xs" title={value}>
        {value}
      </span>
      <CopyButton value={value} label={label} className="text-terminal-dim hover:text-terminal-fg" />
    </span>
  )
}

/** A path is one shell word: quoted when it holds anything the shell would split or expand. */
function quoted(path: string): string {
  return /^[\w~./@+-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`
}

export function AddProjectView() {
  const { t } = useTranslation('projects', { keyPrefix: 'add' })
  const [path, setPath] = useState('')
  const [creating, setCreating] = useState(false)
  const environments = useEnvironments(true)
  const folders = useDiscoveredFolders()
  const { owners } = useEnvironmentOwners()
  const waiting = (environments.data ?? []).filter(
    (environment) =>
      environment.presence === 'live' && !environment.overrides?.archived && !owners.has(environment.name),
  )
  const found = folders.data?.folders ?? []
  const home = folders.data?.home ?? null
  // What was typed, as a folder the collector listed: `~/projects/x` and the absolute path both mean `x`.
  const typed = path
    .trim()
    .replace(/^~\/projects\//, '')
    .replace(home ? `${home}/` : '\0', '')
    .replace(/\/+$/, '')
  const typedMatch = found.find((folder) => folder.path === typed && folder.planned)
  const target = path.trim() === '' ? '~/projects/minha-loja' : quoted(path.trim())

  return (
    <div className="mx-auto w-full max-w-240 min-w-0">
      <PageHeader
        title={t('heading')}
        description={t('description')}
        breadcrumb={[{ label: t('crumb'), href: '/projects' }, { label: t('title') }]}
      />

      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader title={t('folder.title')} description={t('folder.description')} />
          {found.length > 0 ? (
            <ul className="divide-y divide-line border-b border-line">
              {found.map((folder) => (
                <li key={folder.path} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Folder className="size-4 shrink-0 text-subtle" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate font-mono text-sm font-medium text-ink">{`${home ?? '~/projects'}/${folder.path}`}</b>
                    <span className="text-xs text-subtle">
                      {folder.composeFile}
                      {folder.services !== null ? ` · ${t('found.services', { count: folder.services })}` : ''}
                    </span>
                  </span>
                  {folder.registered ? (
                    <Badge tone="ok">{t('found.registered')}</Badge>
                  ) : folder.planned ? (
                    <Button asChild size="sm">
                      <Link href={`/projects/new/review?path=${encodeURIComponent(folder.path)}`}>
                        {t('found.analyze')}
                      </Link>
                    </Button>
                  ) : (
                    <Badge>{t('found.analyzing')}</Badge>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <CardBody className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-sm font-semibold text-ink">{t('folder.label')}</span>
              <Input
                mono
                value={path}
                onChange={(event) => setPath(event.target.value)}
                placeholder="~/projects/minha-loja"
              />
            </label>
            {typedMatch ? (
              <Button asChild size="sm">
                <Link href={`/projects/new/review?path=${encodeURIComponent(typedMatch.path)}`}>
                  {t('found.analyzeTyped')}
                </Link>
              </Button>
            ) : null}
            <div className="space-y-1.5">
              <p className="text-xs text-subtle">{t('folder.analyze')}</p>
              <Command value={`portta envs analyze ${target}`} label={t('copy')} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs text-subtle">{t('folder.adopt')}</p>
              <Command value={`portta adopt ${target}`} label={t('copy')} />
            </div>
          </CardBody>
        </Card>

        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-3 [&>*]:min-w-0">
          <Card>
            <CardBody className="space-y-2.5">
              <h2 className="text-lg font-semibold text-ink">{t('running.title')}</h2>
              <p className="text-sm text-subtle">{t('running.description')}</p>
              {waiting.length === 0 ? (
                <p className="text-sm text-muted">{t('running.none')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {waiting.slice(0, 3).map((environment) => (
                    <li key={environment.name} className="min-w-0 text-sm">
                      <b className="block truncate font-semibold text-ink">{environment.name}</b>
                      <span className="text-xs text-subtle">
                        {t('running.services', { count: environment.serviceCount })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {waiting.length > 0 ? (
                <Button asChild size="sm">
                  <Link href="/projects">{t('running.adopt', { count: waiting.length })}</Link>
                </Button>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2.5">
              <h2 className="text-lg font-semibold text-ink">{t('empty.title')}</h2>
              <p className="text-sm text-subtle">{t('empty.description')}</p>
              <Button size="sm" onClick={() => setCreating(true)}>
                {t('empty.create')}
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardBody className="space-y-2.5">
              <h2 className="text-lg font-semibold text-ink">{t('terminal.title')}</h2>
              <Command value="portta adopt ~/projects/loja-nova" label={t('copy')} />
              <p className="text-xs text-subtle">{t('terminal.hint')}</p>
            </CardBody>
          </Card>
        </div>

        <Callout tone="info" icon={<Terminal className="size-4" />} title={t('agent.title')}>
          <span className="block">{t('agent.description')}</span>
          <span className="mt-2 block">
            <Command value="npx skills add codions-labs/portta -g" label={t('copy')} />
          </span>
        </Callout>
      </div>

      {creating ? <CreateProjectDialog open onOpenChange={setCreating} /> : null}
    </div>
  )
}
