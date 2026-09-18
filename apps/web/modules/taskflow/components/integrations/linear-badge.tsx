'use client'

import type { LinkedLinearIssue } from '../../lib/types.ts'

interface LinearBadgeProps {
  issue: LinkedLinearIssue
  clickable?: boolean
}

const badgeClass = 'inline-flex h-5 shrink-0 items-center rounded-full px-1.5 text-2xs font-medium'

export function LinearBadge({ issue, clickable = false }: LinearBadgeProps) {
  // Linear owns the state colour; the badge only tints with it.
  const style = { color: issue.state.color, background: `${issue.state.color}20` }
  const title = `${issue.identifier} (${issue.state.name})`

  if (clickable) {
    return (
      <a
        href={issue.url}
        target="_blank"
        rel="noopener noreferrer"
        className={`${badgeClass} focus-ring no-underline hover:opacity-80`}
        style={style}
        title={title}
      >
        {issue.identifier}
      </a>
    )
  }

  return (
    <span className={badgeClass} style={style} title={title}>
      {issue.identifier}
    </span>
  )
}
