'use client'

// Why there is nothing to read, said as the thing that would fix it.
//
// The API answers a provider failure with a different status for each cause
// (`FORGE_HTTP_STATUS`), and each cause has a different correction: a Project
// with no provider is configuration, a host with no daemon is one command, a
// rate limit is a wait. One "something went wrong" would throw all of that
// away, so the status picks the sentence and the command here.

import type { Project } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api'
import type { Tone } from '../../lib/tone.ts'
import { CommandRow } from '../copy.tsx'
import { Callout, ErrorBox } from '../shell-bits.tsx'

const TROUBLE = {
  409: { title: 'trouble.noProvider.title', hint: 'trouble.noProvider.hint', tone: 'info', commands: [] },
  // 503 is both "the daemon is not running" and "the host has no `gh`", and
  // the operator cannot tell which from here — so both commands are offered.
  503: {
    title: 'trouble.daemon.title',
    hint: 'trouble.daemon.hint',
    tone: 'warn',
    commands: ['portta host serve', 'gh auth login'],
  },
  401: { title: 'trouble.signedOut.title', hint: 'trouble.signedOut.hint', tone: 'warn', commands: ['gh auth login'] },
  429: { title: 'trouble.rateLimited.title', hint: 'trouble.rateLimited.hint', tone: 'warn', commands: [] },
  404: { title: 'trouble.notFound.title', hint: 'trouble.notFound.hint', tone: 'danger', commands: [] },
} as const satisfies Record<number, { title: string; hint: string; tone: Tone; commands: readonly string[] }>

export function IssueTrouble({
  error,
  work,
  className,
}: {
  error: unknown
  /** The Project's own account of where its work lives, for the 409. */
  work?: Project['work'] | null
  className?: string
}) {
  const { t } = useTranslation('issues')
  const trouble = error instanceof ApiError ? TROUBLE[error.status as keyof typeof TROUBLE] : undefined
  if (!(error instanceof ApiError) || !trouble) return <ErrorBox error={error} />

  // The Project knows why it has no provider in more detail than the refusal does.
  const detail = error.status === 409 ? (work?.reason ?? error.message) : error.message

  return (
    <Callout tone={trouble.tone} title={t(trouble.title)} className={className}>
      <p>{detail}</p>
      <p className="mt-1">{t(trouble.hint)}</p>
      {trouble.commands.length > 0 ? (
        <div className="mt-2 space-y-1">
          {trouble.commands.map((command) => (
            <CommandRow key={command} command={command} />
          ))}
        </div>
      ) : null}
    </Callout>
  )
}
