'use client'

// What every project does about search engines and AI crawlers unless it says otherwise.
//
// The answer starts as "none may", because a work in progress that a search engine or a model
// has read cannot be taken back. Opening it is a choice somebody makes on purpose.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield } from 'lucide-react'
import Link from 'next/link'
import type { CrawlerPolicy } from 'portta-contracts'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CrawlerKindRows, PRESET_POLICY, presetOf } from '@/components/settings/crawler-kinds'
import { OptionCard } from '@/components/settings/option-card'
import { SettingsHeading } from '@/components/settings/settings-shell'
import { Callout, ErrorBox, Loading } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'
import { useCan } from '@/lib/permissions'
import { keys, useCrawlers } from '@/lib/queries'

const PRESETS = ['all', 'noAi', 'open'] as const

export function CrawlersView() {
  const { t } = useTranslation('settings', { keyPrefix: 'crawlers' })
  const queryClient = useQueryClient()
  const mayChange = useCan('settings:manage')
  const query = useCrawlers()
  const [draft, setDraft] = useState<CrawlerPolicy | null>(null)

  const save = useMutation({
    mutationFn: (policy: CrawlerPolicy) => api.setCrawlers(policy),
    onSuccess: () => {
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: keys.crawlers() })
    },
  })

  if (query.isPending) return <Loading />
  if (query.isError) return <ErrorBox error={query.error} />

  const saved = query.data.default
  const shown = draft ?? saved
  const preset = presetOf(shown)
  const tone = preset === 'all' ? 'ok' : preset === 'noAi' ? 'info' : 'warn'

  return (
    <>
      <SettingsHeading title={t('title')} description={t('description')} />
      <div className="space-y-4">
        <Card>
          <CardHeader
            title={t('defaultTitle')}
            description={t('defaultDescription')}
            meta={<Badge tone={tone}>{t(`state.${preset}`)}</Badge>}
          />
          <CardBody className="space-y-2.5">
            <fieldset className="grid gap-2.5">
              <legend className="sr-only">{t('defaultTitle')}</legend>
              {PRESETS.map((option) => (
                <OptionCard
                  key={option}
                  name="crawler-preset"
                  checked={preset === option}
                  disabled={!mayChange || save.isPending}
                  onSelect={() => setDraft(PRESET_POLICY[option])}
                  title={t(`presets.${option}.title`)}
                  help={t(`presets.${option}.help`)}
                />
              ))}
            </fieldset>
            <CrawlerKindRows policy={shown} />
            <Callout icon={<Shield />}>
              {t('howTitle')} {t('howBody')}
            </Callout>
            <Callout>{t('panelNote')}</Callout>
            {save.isError ? <ErrorBox error={save.error} /> : null}
          </CardBody>
          <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            <span className="text-xs text-subtle">{t('effect')}</span>
            <span className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={draft === null || save.isPending}
                onClick={() => setDraft(null)}
              >
                {t('discard')}
              </Button>
              <Button
                size="sm"
                disabled={draft === null || !mayChange || save.isPending}
                onClick={() => draft && save.mutate(draft)}
              >
                {t('save')}
              </Button>
            </span>
          </div>
        </Card>

        <Card>
          <CardHeader title={t('exceptionsTitle')} description={t('exceptionsDescription')} />
          {query.data.exceptions.length === 0 ? (
            <CardBody>
              <p className="text-sm text-subtle">{t('noExceptions')}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-line">
              {query.data.exceptions.map((exception) => (
                <li key={exception.project} className="flex items-center justify-between gap-3 px-5 py-3">
                  <Link
                    href={`/projects/${exception.project}/settings`}
                    className="text-sm font-semibold text-ink hover:underline focus-ring"
                  >
                    {exception.name}
                  </Link>
                  <Badge
                    tone={
                      exception.policy === null ? 'warn' : presetOf(exception.policy) === 'custom' ? 'warn' : 'info'
                    }
                  >
                    {t(`state.${exception.policy === null ? 'mixed' : presetOf(exception.policy)}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
