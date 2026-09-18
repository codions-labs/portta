import type { Commit } from 'portta-contracts'
import { useFormat } from '../../lib/use-format.ts'
import { cn } from '../../lib/utils.ts'
import { Mono } from '../copy.tsx'

/** One commit, as a line: sha, subject, author and when. The sha is a link when the forge is known. */
export function CommitRow({ commit, className }: { commit: Commit; className?: string }) {
  const { relativeTime } = useFormat()
  const sha = commit.url ? (
    <a
      className="rounded-xs font-mono text-xs text-accent underline-offset-2 hover:underline focus-ring"
      href={commit.url}
      target="_blank"
      rel="noreferrer noopener"
    >
      {commit.shortSha}
    </a>
  ) : (
    <Mono kind="sha" className="text-xs">
      {commit.shortSha}
    </Mono>
  )
  return (
    <div
      className={cn('flex min-h-8 flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5 text-sm', className)}
      data-commit={commit.sha}
    >
      {sha}
      <span className="min-w-0 flex-1 truncate text-ink" title={commit.subject}>
        {commit.subject}
      </span>
      <span className="text-xs text-subtle">
        {commit.author}
        {commit.date ? ` · ${relativeTime(commit.date)}` : ''}
      </span>
    </div>
  )
}
