'use client'

import type { ContainerState, EndpointScope, Health, Ownership, UrlScope } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import type { Tone } from '../lib/tone.ts'
import { Badge, StatusIndicator } from './ui/badge.tsx'

const STATE_TONE: Record<string, Tone> = {
  running: 'ok',
  restarting: 'warn',
  paused: 'warn',
  created: 'neutral',
  removing: 'warn',
  exited: 'neutral',
  dead: 'danger',
  absent: 'neutral',
}

/** The tone of a container, from its state and, when it has one, its health. */
export function containerTone(state: ContainerState | 'absent', health?: Health): Tone {
  return health === 'unhealthy' ? 'danger' : health === 'starting' ? 'warn' : (STATE_TONE[state] ?? 'neutral')
}

/**
 * What a container is doing, as a dot and a word: `● running · healthy`.
 * The dot carries the colour; the word stays quiet, so a column of thirty of
 * them is read by the dots and confirmed by the words.
 */
export function StateBadge({
  state,
  health,
  completed,
  emphasis = 'muted',
}: {
  state: ContainerState | 'absent'
  health?: Health
  completed?: boolean
  emphasis?: 'ink' | 'muted' | 'tone'
}) {
  const { t } = useTranslation('common')
  // A one-shot that exited 0 is not "exited" the way a crashed service is.
  if (completed && state === 'exited') {
    return (
      <StatusIndicator tone="neutral" emphasis={emphasis}>
        {t('state.completed')}
      </StatusIndicator>
    )
  }
  const stateLabel = t(`state.${state}`, { defaultValue: state })
  const healthLabel = health && health !== 'none' ? t(`health.${health}`, { defaultValue: health }) : null
  const label = healthLabel && state === 'running' ? `${stateLabel} · ${healthLabel}` : stateLabel
  const tone = containerTone(state, health)
  return (
    <StatusIndicator tone={tone} emphasis={emphasis} pulse={state === 'restarting' || health === 'starting'}>
      {label}
    </StatusIndicator>
  )
}

/**
 * The single most important distinction in the panel: what the gateway manages,
 * and what merely happens to be running on the same host.
 */
export function OwnershipBadge({ ownership }: { ownership: Ownership }) {
  const { t } = useTranslation('common')
  const tone =
    ownership === 'gateway'
      ? 'accent'
      : ownership === 'integrated'
        ? 'info'
        : ownership === 'external'
          ? 'neutral'
          : 'outline'
  return <Badge tone={tone}>{t(`ownership.${ownership}`)}</Badge>
}

const SCOPE_TONE: Record<EndpointScope | UrlScope, 'neutral' | 'info' | 'warn'> = {
  internal: 'neutral',
  local: 'neutral',
  lan: 'info',
  private: 'info',
  vpn: 'info',
  protected: 'warn',
  public: 'warn',
}

export function ScopeBadge({ scope }: { scope: EndpointScope | UrlScope }) {
  const { t } = useTranslation('common')
  return <Badge tone={SCOPE_TONE[scope]}>{t(`scope.${scope}`)}</Badge>
}
