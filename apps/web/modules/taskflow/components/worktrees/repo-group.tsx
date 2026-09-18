'use client'

import type { PrEntry, ServiceStatus } from '../../lib/types.ts'
import { cn } from '../../lib/utils.ts'
import { CursorButton } from './cursor-button.tsx'
import { PrStatusGroup } from './pr-status-group.tsx'

interface RepoGroupProps {
  label?: string
  prs: PrEntry[]
  services?: ServiceStatus[]
  cursorUrl?: string | null
  onCiClick: (pr: PrEntry) => void
  onReviewsClick: (pr: PrEntry) => void
}

export function RepoGroup({ label, prs, services = [], cursorUrl = null, onCiClick, onReviewsClick }: RepoGroupProps) {
  return (
    <div className="repo-group flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
      {label ? <span className="shrink-0 text-2xs font-medium text-subtle">{label}:</span> : null}
      {prs.map((pr) => (
        <PrStatusGroup key={`${pr.repo}#${pr.number}`} pr={pr} onCiClick={onCiClick} onReviewsClick={onReviewsClick} />
      ))}
      {services.map((service) =>
        service.port ? (
          <a
            key={`${service.name}:${service.port}`}
            href={`${window.location.protocol}//${window.location.hostname}:${service.port}`}
            target="_blank"
            rel="noopener"
            className={cn(
              'inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono text-2xs no-underline hover:opacity-80',
              service.running ? 'border-ok/35 text-ok' : 'pointer-events-none border-line text-subtle',
            )}
          >
            {service.name} :{service.port}
          </a>
        ) : null,
      )}
      {cursorUrl ? <CursorButton url={cursorUrl} /> : null}
    </div>
  )
}
