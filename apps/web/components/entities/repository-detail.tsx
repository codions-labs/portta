'use client'

import { ExternalLink } from 'lucide-react'
import type { Repository, RepositoryGit } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { projectGitOf } from '../../lib/git.ts'
import { Mono } from '../copy.tsx'
import { KeyValue } from '../shell-bits.tsx'
import { Badge } from '../ui/badge.tsx'
import { Card, CardBody, CardHeader } from '../ui/card.tsx'
import { GitStatusLine } from './git-status-line.tsx'

/** The whole of what is known about one repository: registration and scan, as rows. */
export function RepositoryDetail({ repository, git }: { repository: Repository; git: RepositoryGit | null }) {
  const { t } = useTranslation('repositories', { keyPrefix: 'detail' })
  const path = repository.scanPath ?? repository.localPath
  return (
    <Card>
      <CardHeader
        title={t('title')}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {repository.role ? <Badge tone="outline">{repository.role}</Badge> : null}
            <Badge tone="neutral">{repository.provider}</Badge>
            {repository.relativePath ? <span>{t('inside', { path: repository.relativePath })}</span> : null}
          </span>
        }
      />
      <CardBody>
        <dl className="divide-y divide-line-subtle">
          <KeyValue label={t('directory')}>
            {path ? <Mono kind="path" tone="ink" value={path} /> : <span className="text-subtle">{t('noPath')}</span>}
          </KeyValue>
          {repository.remoteUrl ? (
            <KeyValue label={t('remote')}>
              <Mono kind="url" tone="ink" value={repository.remoteUrl} />
            </KeyValue>
          ) : null}
          {repository.github ? (
            <KeyValue label="GitHub">
              <a
                className="inline-flex items-center gap-1 rounded-xs underline-offset-2 hover:underline focus-ring"
                href={repository.github.htmlUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {repository.github.slug}
                <ExternalLink className="size-3" />
              </a>
            </KeyValue>
          ) : null}
        </dl>
        <div className="mt-2 border-t border-line pt-2">
          {git ? <GitStatusLine git={projectGitOf(git)} variant="block" /> : null}
        </div>
      </CardBody>
    </Card>
  )
}
