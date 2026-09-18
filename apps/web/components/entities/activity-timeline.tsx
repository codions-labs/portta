'use client'

import { Bot, Boxes, CircleDot, Container, FolderGit2, type LucideIcon, User } from 'lucide-react'
import type { ActivityEvent } from 'portta-contracts'
import { issueRefLabel, issueRefUrl } from 'portta-core/browser'
import { useTranslation } from 'react-i18next'
import { useFormat } from '../../lib/use-format.ts'
import { Empty } from '../shell-bits.tsx'
import { Button } from '../ui/button.tsx'
import { Timeline, TimelineItem } from '../ui/timeline.tsx'

type Entity = 'issue' | 'session' | 'repository' | 'environment' | 'service' | 'project'

function entityOf(kind: string): Entity {
  return (kind.split('.')[0] ?? 'project') as Entity
}

const ICONS: Record<Entity, LucideIcon> = {
  issue: CircleDot,
  session: Bot,
  repository: FolderGit2,
  environment: Container,
  service: Container,
  project: Boxes,
}

function toneOf(kind: string): 'neutral' | 'ok' | 'warn' | 'danger' | 'info' {
  if (kind === 'service.unhealthy' || kind === 'environment.removed') return 'danger'
  if (kind === 'session.abandoned') return 'warn'
  if (kind.endsWith('.started') || kind === 'issue.created' || kind === 'repository.commit') return 'info'
  if (kind === 'service.recovered' || kind === 'session.ended' || kind === 'issue.state') return 'ok'
  return 'neutral'
}

/** What happened, newest first, each event pointing at what it concerns. */
export function ActivityTimeline({
  events,
  compact = false,
  showProject = false,
  onLoadMore,
  loadingMore = false,
  emptyTitle,
}: {
  events: ActivityEvent[]
  compact?: boolean
  showProject?: boolean
  onLoadMore?: (() => void) | null
  loadingMore?: boolean
  emptyTitle?: string
}) {
  const { t } = useTranslation('activity')
  const { relativeTime } = useFormat()

  if (events.length === 0) return <Empty title={emptyTitle ?? t('empty')} hint={compact ? undefined : t('emptyHint')} />

  return (
    <div className="px-3 py-3">
      <Timeline>
        {events.map((event) => {
          const Icon = ICONS[entityOf(event.kind)]
          const ActorIcon = event.actorKind === 'agent' ? Bot : User
          return (
            <TimelineItem key={event.id} time={relativeTime(event.at)} tone={toneOf(event.kind)}>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <Icon className="size-3.5 shrink-0 text-subtle" aria-hidden />
                <span className="min-w-0">{event.summary}</span>
                {event.actor ? (
                  <span className="inline-flex items-center gap-1 text-2xs text-subtle">
                    <ActorIcon className="size-3" aria-hidden />
                    {event.actor}
                  </span>
                ) : null}
              </div>
              {!compact ? (
                <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-subtle">
                  {showProject && event.project ? (
                    <a
                      className="rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring"
                      href={`/projects/${encodeURIComponent(event.project)}`}
                    >
                      {event.project}
                    </a>
                  ) : null}
                  {event.issueRef ? <IssueLink issueRef={event.issueRef} /> : null}
                  {event.repositoryId && event.project ? (
                    <a
                      className="rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring"
                      href={`/projects/${encodeURIComponent(event.project)}/repositories/${encodeURIComponent(event.repositoryId)}`}
                    >
                      {event.repositoryName ?? t('repository')}
                    </a>
                  ) : null}
                  {event.environment ? (
                    <a
                      className="rounded-xs font-mono underline-offset-2 hover:text-ink hover:underline focus-ring"
                      href={`/environments/${encodeURIComponent(event.environment)}`}
                    >
                      {event.environment}
                    </a>
                  ) : null}
                </div>
              ) : null}
            </TimelineItem>
          )
        })}
      </Timeline>
      {onLoadMore ? (
        <div className="mt-2">
          <Button size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {t('loadMore')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** A Linear ref has no URL of its own, so it reads as text rather than a link. */
function IssueLink({ issueRef }: { issueRef: string }) {
  const label = issueRefLabel(issueRef)
  const url = issueRefUrl(issueRef)
  if (!url) return <span>{label}</span>
  return (
    <a
      className="rounded-xs underline-offset-2 hover:text-ink hover:underline focus-ring"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  )
}
