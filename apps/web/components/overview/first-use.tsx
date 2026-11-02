'use client'

// What Home is before there is a project: where to start, and how far along this
// host is. It says only what the panel can read, and it goes away with the first
// project, or as soon as somebody asks for the panel instead.

import { Activity, ChevronRight, FolderOpen, Terminal } from 'lucide-react'
import Link from 'next/link'
import { docsHref } from 'portta-contracts'
import { type ComponentType, type ReactNode, useCallback, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton } from '@/components/copy'
import { PageHeader } from '@/components/shell-bits'
import { StatusDot } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { useCan } from '@/lib/permissions'
import { usePrincipal } from '@/lib/principal'
import { useEnvironments, useGateway, useStatus } from '@/lib/queries'
import { useAuthSession } from '@/lib/queries/auth-session'
import { cn } from '@/lib/utils'

const AGENTS_COMMAND = 'portta agents install'
const DISMISSED = 'portta-first-use-dismissed'

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED) === '1'
  } catch {
    return false
  }
}

/** Remembered in this browser: seeing the panel instead is a convenience, not a setting. */
export function useFirstUseDismissal(): [boolean, () => void] {
  const stored = useSyncExternalStore(
    () => () => undefined,
    readDismissed,
    () => false,
  )
  const [now, setNow] = useState(false)
  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(DISMISSED, '1')
    } catch {
      // A private window forgets this, and the page still does what was asked.
    }
    setNow(true)
  }, [])
  return [stored || now, dismiss]
}

function StartOption({
  href,
  external = false,
  primary = false,
  icon: Icon,
  title,
  help,
}: {
  href?: string
  external?: boolean
  primary?: boolean
  icon: ComponentType<{ className?: string }>
  title: string
  help: string
}) {
  const inner = (
    <>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-ink">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-sm text-subtle">{help}</span>
      </span>
      {href ? <ChevronRight className="mt-1.5 size-4 shrink-0 text-subtle" aria-hidden /> : null}
    </>
  )
  const box = cn(
    'flex items-start gap-3 rounded-xl border bg-surface px-3.5 py-3 transition-colors duration-100',
    primary ? 'border-accent shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'border-line',
    href && 'hover:bg-fill focus-ring',
  )
  if (!href) return <div className={box}>{inner}</div>
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={box}>
      {inner}
    </a>
  ) : (
    <Link href={href} className={box}>
      {inner}
    </Link>
  )
}

interface Step {
  id: string
  done: boolean
  title: string
  detail: string
}

function Readiness({ account }: { account: boolean | null }) {
  const { t } = useTranslation('overview', { keyPrefix: 'firstUse.steps' })
  const status = useStatus()
  const gateway = useGateway(useCan('gateway:read'))
  const up = status.data?.gateway.up ?? gateway.data?.up ?? false
  const domain = gateway.data?.domain
  const tls = gateway.data?.tls.enabled ?? false
  const local = domain === 'localhost'

  const steps: Step[] = [
    {
      id: 'gateway',
      done: up,
      title: t('gateway.title'),
      detail: up ? t('gateway.up') : t('gateway.down'),
    },
    ...(domain
      ? [
          {
            id: 'domain',
            // localhost needs no certificate; a name the world can ask for does.
            done: local || tls,
            title: t('domain.title'),
            detail: local ? t('domain.local') : tls ? t('domain.secured', { domain }) : t('domain.plain', { domain }),
          },
        ]
      : []),
    { id: 'project', done: false, title: t('project.title'), detail: t('project.detail') },
    ...(account === null
      ? []
      : [
          {
            id: 'account',
            done: account,
            title: t('account.title'),
            detail: account ? t('account.done') : t('account.detail'),
          },
        ]),
    // Only `portta agents status` can tell, on the host: the panel cannot, so this never reads as done.
    { id: 'agents', done: false, title: t('agents.title'), detail: t('agents.detail') },
  ]

  return (
    <Card>
      <CardHeader
        title={t('title')}
        actions={
          <span className="text-xs text-subtle tabular-nums">
            {t('progress', { done: steps.filter((step) => step.done).length, total: steps.length })}
          </span>
        }
      />
      <ul>
        {steps.map((step) => (
          <li key={step.id} className="flex items-start gap-3 border-t border-line px-5 py-3 first:border-t-0">
            <span className="mt-1.5 shrink-0">
              <StatusDot
                tone={step.done ? 'ok' : step.id === 'gateway' ? 'danger' : 'neutral'}
                label={step.done ? t('done') : t('pending')}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{step.title}</span>
              <span className="block text-xs text-subtle">{step.detail}</span>
            </span>
          </li>
        ))}
        <li className="border-t border-line px-5 py-3">
          <span className="flex items-center gap-1 rounded-md bg-terminal py-1 pr-1 pl-3 text-terminal-fg">
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{AGENTS_COMMAND}</span>
            <CopyButton
              value={AGENTS_COMMAND}
              label={t('agents.copy')}
              className="text-terminal-dim hover:text-terminal-fg"
            />
          </span>
        </li>
      </ul>
    </Card>
  )
}

/** A panel that signs nobody in has no account to protect, and no session to ask about. */
function ReadinessWithAccount() {
  const { data: session } = useAuthSession()
  const enabled = (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled ?? false
  return <Readiness account={enabled} />
}

export function FirstUse({ onDismiss, attention }: { onDismiss: () => void; attention: ReactNode }) {
  const { t } = useTranslation('overview', { keyPrefix: 'firstUse' })
  const principal = usePrincipal()
  const status = useStatus()
  const environments = useEnvironments(true, useCan('environment:read'))
  const up = status.data?.gateway.up ?? true
  const docs = status.data?.gateway.panel.docs ?? false
  const waiting = (environments.data ?? []).filter(
    (environment) => environment.presence === 'live' && !environment.overrides?.archived,
  ).length

  return (
    <>
      <PageHeader title={up ? t('title') : t('titleDown')} description={up ? t('description') : t('descriptionDown')} />
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[999_1_32rem] space-y-3">
          <p className="text-2xs font-semibold tracking-[0.14em] text-subtle uppercase">{t('start')}</p>
          <StartOption
            primary
            href="/projects?new=1"
            icon={FolderOpen}
            title={t('options.compose.title')}
            help={t('options.compose.help')}
          />
          {waiting > 0 ? (
            <StartOption
              href="/projects"
              icon={Activity}
              title={t('options.running.title')}
              help={t('options.running.help', { count: waiting })}
            />
          ) : null}
          <StartOption
            href={docs ? docsHref('docs/product/guides/adopting-projects.md') : undefined}
            external
            icon={Terminal}
            title={t('options.agent.title')}
            help={t('options.agent.help')}
          />
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xs text-sm font-medium text-link underline-offset-2 hover:underline focus-ring"
          >
            {t('dismiss')}
          </button>
        </div>
        <div className="min-w-0 flex-[1_1_20rem]">
          {principal.kind === 'local' ? <Readiness account={null} /> : <ReadinessWithAccount />}
        </div>
      </div>
      {attention ? <div className="mt-6">{attention}</div> : null}
    </>
  )
}
