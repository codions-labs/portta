'use client'

// Turning on a second factor, in the order the person has to do it: prove it is
// you, scan the code, prove the app works, then keep the backup codes.
//
// The backup codes are shown once, like a token's secret, and for the same
// reason: the panel keeps hashes of them. Nothing here closes on its own while
// they are on screen.

import { ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CopyButton, Pre } from '@/components/copy'
import { Callout } from '@/components/shell-bits'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { Field, Input } from '@/components/ui/field'
import { authClient } from '@/lib/auth-client'
import { usePrincipal } from '@/lib/principal'
import { QrCode } from './qr-code'

type Step =
  | { at: 'closed' }
  | { at: 'password'; next: 'enable' | 'disable' }
  | { at: 'scan'; uri: string; backupCodes: string[] }
  | { at: 'codes'; backupCodes: string[] }

export function TwoFactorCard() {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
  const principal = usePrincipal()
  const { data: session, refetch } = authClient.useSession()
  const [step, setStep] = useState<Step>({ at: 'closed' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const enabled = (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled ?? false

  const close = () => {
    setStep({ at: 'closed' })
    setPassword('')
    setCode('')
    setError(null)
  }

  async function withPassword() {
    if (step.at !== 'password') return
    setBusy(true)
    setError(null)
    if (step.next === 'disable') {
      const { error: refused } = await authClient.twoFactor.disable({ password })
      setBusy(false)
      if (refused) return setError(refused.message ?? t('security.wrongPassword'))
      await refetch()
      return close()
    }
    const { data, error: refused } = await authClient.twoFactor.enable({ password, method: 'totp' })
    setBusy(false)
    if (refused || !data) return setError(refused?.message ?? t('security.wrongPassword'))
    // The endpoint answers for whichever method it enabled; only the TOTP
    // shape carries a URI to scan, and TOTP is the only one this panel asks for.
    if (!('totpURI' in data)) return setError(t('security.totpUnavailable'))
    // `enable` writes the secret but leaves the factor unverified: it counts
    // only once a code from the app comes back.
    setPassword('')
    setStep({ at: 'scan', uri: data.totpURI, backupCodes: data.backupCodes })
  }

  async function verify() {
    if (step.at !== 'scan') return
    setBusy(true)
    setError(null)
    const { error: refused } = await authClient.twoFactor.verifyTotp({ code })
    setBusy(false)
    if (refused) return setError(t('security.invalidCode'))
    await refetch()
    setCode('')
    setStep({ at: 'codes', backupCodes: step.backupCodes })
  }

  return (
    <>
      <Card>
        <CardHeader
          title={t('security.twoFactor')}
          description={t('security.twoFactorDescription')}
          icon={<ShieldCheck />}
          meta={
            enabled ? <Badge tone="ok">{t('security.on')}</Badge> : <Badge tone="neutral">{t('security.off')}</Badge>
          }
          actions={
            <Button
              size="sm"
              variant={enabled ? 'default' : 'primary'}
              onClick={() => setStep({ at: 'password', next: enabled ? 'disable' : 'enable' })}
            >
              {enabled ? t('security.turnOff') : t('security.turnOn')}
            </Button>
          }
        />
        {enabled ? null : (
          <CardBody className="text-xs text-subtle">
            {t('security.twoFactorHint', { email: principal.email ?? '' })}
          </CardBody>
        )}
      </Card>

      <Dialog
        open={step.at === 'password'}
        onOpenChange={close}
        size="sm"
        title={step.at === 'password' && step.next === 'disable' ? t('security.turnOff') : t('security.turnOn')}
        description={t('security.confirmPassword')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" size="sm" busy={busy} disabled={password === ''} onClick={withPassword}>
              {tc('continue')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
          <Field label={t('security.currentPassword')} required>
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
              />
            )}
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={step.at === 'scan'}
        onOpenChange={close}
        size="sm"
        title={t('security.scanTitle')}
        description={t('security.scanDescription')}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button variant="primary" size="sm" busy={busy} disabled={code.length < 6} onClick={verify}>
              {t('security.verify')}
            </Button>
          </>
        }
      >
        {step.at === 'scan' ? (
          <div className="grid gap-3">
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            <QrCode value={step.uri} label={t('security.qrLabel')} />
            <p className="text-xs text-subtle">{t('security.cannotScan')}</p>
            <Pre className="text-2xs">{secretOf(step.uri)}</Pre>
            <Field label={t('security.codeFromApp')} required>
              {(id) => (
                <Input
                  id={id}
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value.trim())}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  mono
                />
              )}
            </Field>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={step.at === 'codes'}
        dismissible={false}
        onOpenChange={() => undefined}
        size="sm"
        title={t('security.backupTitle')}
        description={t('security.backupDescription')}
        footer={
          <>
            {step.at === 'codes' ? (
              <CopyButton value={step.backupCodes.join('\n')} label={t('security.copyCodes')} />
            ) : null}
            <Button variant="primary" size="sm" onClick={close}>
              {t('tokens.copied')}
            </Button>
          </>
        }
      >
        {step.at === 'codes' ? (
          <div className="grid gap-3">
            <Callout tone="warn">{t('security.backupOnce')}</Callout>
            <Pre>{step.backupCodes.join('\n')}</Pre>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}

/** The shared secret inside an `otpauth://` URI, for an app that cannot scan. */
function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? uri
  } catch {
    return uri
  }
}
