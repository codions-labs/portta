'use client'

import { Clock, Loader2 } from 'lucide-react'
import type { ApplyStatus } from 'portta-contracts'
import { useTranslation } from 'react-i18next'
import { toneBorder, toneText, toneWash } from '../lib/tone.ts'
import { useApply } from '../lib/use-apply.ts'
import { cn } from '../lib/utils.ts'
import { ApplyDialog } from './apply-dialog.tsx'
import { CodeChip, CopyButton } from './copy.tsx'
import { Button } from './ui/button.tsx'

/**
 * Saved settings that are not running yet, shown on every page.
 *
 * The Settings page is the one place where the operator already knows; anywhere
 * else the panel would describe a gateway that disagrees with what was saved
 * and say nothing about it. This sits beside the connection banner, so the
 * pending state follows the operator around. It carries the button when the
 * host has an applier, and the host command when it does not, so a host that
 * has not opted in still learns what to run.
 *
 * Warn, not danger: saved-and-not-applied is stale, not failed. The field
 * badges already use that tone for the same fact.
 */
export function ApplyBar({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  const { t: tc } = useTranslation('common')
  const machine = useApply()
  const status = machine.status

  // An apply already in flight opens its own dialog: useApply resumes from the
  // applier's state, so a reload or a second tab lands back in the progress
  // view rather than on a panel that looks idle while the host is churning.
  const dialog = <ApplyDialog machine={machine} readOnly={readOnly} />
  if (!status) return dialog

  const applying = machine.busy || status.state === 'running'
  if (!status.pendingRestart && !applying) return dialog

  const canApply = status.available && !readOnly
  const pendingCount = status.pendingChanges.length || status.pendingKeys.length
  const needsRecreate =
    status.pendingChanges.some((change) => change.restartRequired) || status.pendingChanges.length === 0

  return (
    <>
      <div
        role="status"
        className={cn(
          'flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 text-xs',
          applying
            ? cn(toneBorder.info, toneWash.info, toneText.info)
            : cn(toneBorder.warn, toneWash.warn, toneText.warn),
        )}
      >
        {applying ? <Loader2 className="size-3.5 shrink-0 animate-spin" /> : <Clock className="size-3.5 shrink-0" />}
        <span>{applying ? t('barApplying') : t('barPending', { count: pendingCount })}</span>

        {applying || machine.phase === 'confirming' ? null : canApply ? (
          <span className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={machine.open}>
              {t('barReview')}
            </Button>
            {needsRecreate ? (
              <Button size="sm" variant="primary" onClick={machine.open}>
                {t('barAction')}
              </Button>
            ) : null}
          </span>
        ) : (
          <>
            <span className="ml-auto">{t('barManual')}</span>
            <CodeChip>{status.applyCommand}</CodeChip>
            <CopyButton value={status.applyCommand} label={tc('copyCommand')} />
            {/* Read-only is a deliberate posture, so it gets no instructions
                for undoing itself. */}
            {!readOnly ? <Unavailable status={status} /> : null}
          </>
        )}
      </div>
      {dialog}
    </>
  )
}

/**
 * Why there is no button, in one sentence that says what to do about it.
 *
 * Three situations look identical from here — the applier container is simply
 * absent — and they have three different fixes. One sentence for all of them
 * would tell an operator who has already set PORTTA_APPLY to go and set
 * PORTTA_APPLY.
 *
 * Spelled out rather than interpolated, like the phases in the dialog: the keys
 * are type-checked against the catalogue this way. `refused` is the one case
 * the panel quotes the host for, because the host phrased it better.
 */
function Unavailable({ status }: { status: ApplyStatus }) {
  const { t } = useTranslation('gateway', { keyPrefix: 'apply' })
  const reason = status.unavailableReason
  if (!reason) return null

  return (
    <span className="text-subtle">
      {reason === 'disabled'
        ? t('unavailable.disabled')
        : reason === 'not-prepared'
          ? t('unavailable.notPrepared')
          : t('unavailable.refused', { reason: status.reason ?? '' })}
    </span>
  )
}
