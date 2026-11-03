import { Clock, Eye, EyeOff, FlaskConical, LockKeyhole, ShieldCheck, Users } from 'lucide-react'
import { type FormEvent, StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { Button } from './components/button.tsx'
import { Input } from './components/field.tsx'
import { ServiceIcon } from './components/service-icon.tsx'
import { initializeAuthI18n } from './i18n.ts'
import './globals.css'
import './style.css'

interface AuthContext {
  locale: 'en' | 'pt-BR'
  state: 'login' | 'unavailable'
  next: string
  error: boolean
  lockedMinutes?: number
  panel?: { url: string; notice?: 'signedOut' | 'denied' | 'expired' }
  protection?: {
    label: string
    host: string
    project?: string
    service?: string
    passwordOnly?: boolean
    tech?: { id: string; label: string }
  }
}

function readContext(): AuthContext {
  const element = document.getElementById('portta-auth-context')
  if (!element?.textContent) throw new Error('missing Portta auth context')
  return JSON.parse(element.textContent) as AuthContext
}

const context = readContext()
initializeAuthI18n(context.locale)
document.documentElement.lang = context.locale

function PorttaMark() {
  return (
    <div className="portta-mark" aria-hidden="true">
      <span className="portta-mark-door" />
      <span className="portta-mark-path" />
    </div>
  )
}

/**
 * Why somebody is looking at a login page for something they were sent. These
 * links go to clients and reviewers who have never heard of Portta, so the page
 * explains itself before it asks for anything.
 */
function Reasons({ unavailable, passwordOnly }: { unavailable: boolean; passwordOnly: boolean }) {
  const { t } = useTranslation('auth')
  const rows = unavailable
    ? [
        { key: 'expected', icon: Clock },
        { key: 'untouched', icon: Users },
        { key: 'comeBack', icon: LockKeyhole },
      ]
    : [
        { key: 'wip', icon: FlaskConical },
        { key: 'guests', icon: Users },
        { key: 'private', icon: LockKeyhole },
      ]
  const group = unavailable ? 'unavailableReasons' : 'reasons'

  return (
    <section className="auth-why" aria-label={t(unavailable ? 'unavailableWhyLabel' : 'whyLabel')}>
      <p className="auth-eyebrow">{t(unavailable ? 'unavailableWhyLabel' : 'whyLabel')}</p>
      {rows.map(({ key, icon: Icon }) => (
        <div key={key} className="auth-why-row">
          <span className="auth-why-icon">
            <Icon aria-hidden="true" />
          </span>
          <span>
            <b>{t(`${group}.${key}.title`)}</b>
            <small>{t(`${group}.${key}.help${passwordOnly && key === 'guests' ? 'PasswordOnly' : ''}`)}</small>
          </span>
        </div>
      ))}
    </section>
  )
}

function AuthPage() {
  const { t } = useTranslation('auth')
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)
  const { protection, state } = context
  const unavailable = state === 'unavailable' || !protection
  const locked = context.lockedMinutes !== undefined
  const passwordOnly = protection?.passwordOnly === true

  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) event.preventDefault()
    else setPending(true)
  }

  return (
    <main className="auth-stage">
      <div className="auth-glow auth-glow-a" aria-hidden="true" />
      <div className="auth-glow auth-glow-b" aria-hidden="true" />
      <div className="auth-glow auth-glow-c" aria-hidden="true" />

      <div className="auth-layout">
        <section className="auth-intro" aria-label={t('protectedBy')}>
          <div className="auth-brand">
            <PorttaMark />
            <span>Portta</span>
          </div>
          <div className={unavailable ? 'auth-kicker auth-kicker-warn' : 'auth-kicker'}>
            <ShieldCheck aria-hidden="true" />
            {t(unavailable ? 'unavailableKicker' : 'protectedAccess')}
          </div>
          <h1>{t(unavailable ? 'unavailableHeading' : 'heading')}</h1>
          <p>{t(unavailable ? 'unavailableLead' : 'explanation')}</p>
        </section>

        <Reasons unavailable={unavailable} passwordOnly={passwordOnly} />

        <section className="auth-card" aria-labelledby="destination-name">
          <div className="auth-card-body">
            {protection ? (
              <>
                <div className="auth-destination">
                  <div className="auth-service-icon">
                    {protection.tech ? (
                      <ServiceIcon tech={protection.tech} className="[&>svg]:h-6 [&>svg]:w-6" />
                    ) : (
                      <LockKeyhole className="h-6 w-6" aria-hidden="true" />
                    )}
                  </div>
                  <div>
                    <p className="auth-eyebrow">{t('destination')}</p>
                    <h2 id="destination-name">{protection.label}</h2>
                    <p className="auth-host">{protection.host}</p>
                  </div>
                </div>

                {(protection.project || protection.service || protection.tech) && (
                  <dl className="auth-meta">
                    {protection.project && (
                      <div>
                        <dt>{t('project')}</dt>
                        <dd>{protection.project}</dd>
                      </div>
                    )}
                    {protection.service && (
                      <div>
                        <dt>{t('service')}</dt>
                        <dd>{protection.service}</dd>
                      </div>
                    )}
                    {protection.tech && (
                      <div>
                        <dt>{t('technology')}</dt>
                        <dd>{protection.tech.label}</dd>
                      </div>
                    )}
                  </dl>
                )}

                <p className="auth-hint">{t(passwordOnly ? 'formHintPasswordOnly' : 'formHint')}</p>

                {context.error && (
                  <p className="auth-error" role="alert">
                    {locked
                      ? t('locked', { count: context.lockedMinutes })
                      : t(passwordOnly ? 'invalidPasswordOnly' : 'invalid')}
                  </p>
                )}

                <form method="post" action="/__portta/auth/login" onSubmit={submit} className="auth-form">
                  <input type="hidden" name="next" value={context.next} />
                  {passwordOnly ? null : (
                    <div className="auth-field">
                      <label htmlFor="user">{t('username')}</label>
                      <Input id="user" name="user" autoComplete="username" required autoFocus spellCheck={false} />
                    </div>
                  )}
                  <div className="auth-field">
                    <label htmlFor="password">{t('password')}</label>
                    <div className="auth-password">
                      <Input
                        id="password"
                        name="password"
                        type={visible ? 'text' : 'password'}
                        autoComplete="current-password"
                        required
                        autoFocus={passwordOnly}
                      />
                      <button
                        type="button"
                        onClick={() => setVisible((value) => !value)}
                        aria-label={visible ? t('hidePassword') : t('showPassword')}
                      >
                        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="md"
                    disabled={pending || locked}
                    className="auth-submit"
                  >
                    {pending ? (
                      <span className="auth-spinner" aria-hidden="true" />
                    ) : (
                      <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                    )}
                    {pending ? t('signingIn') : t('signIn')}
                  </Button>
                </form>
                {context.panel && (
                  <div className="auth-panel">
                    {context.panel.notice && context.panel.notice !== 'signedOut' && (
                      <p className="auth-error" role="alert">
                        {t(`panelNotice.${context.panel.notice}`)}
                      </p>
                    )}
                    <div className="auth-or" role="separator">
                      <span>{t('or')}</span>
                    </div>
                    <a className="auth-panel-link" href={context.panel.url}>
                      <Users aria-hidden="true" />
                      {t('continueWithPanel')}
                    </a>
                    <p className="auth-help">
                      {t(context.panel.notice === 'signedOut' ? 'panelNotice.signedOut' : 'panelHelp')}
                    </p>
                  </div>
                )}
                <p className="auth-help">{t('noAccess')}</p>
              </>
            ) : (
              <>
                <h2 id="destination-name">{t('unavailableCardTitle')}</h2>
                <div className="auth-callout">
                  <Clock aria-hidden="true" />
                  <span>{t('unavailableCard')}</span>
                </div>
                <p className="auth-help">{t('unavailableHelp')}</p>
              </>
            )}
          </div>
        </section>
      </div>

      <p className="auth-footer">
        <ShieldCheck aria-hidden="true" />
        {t('protectedBy')}
      </p>
    </main>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('no #root element')
createRoot(root).render(
  <StrictMode>
    <AuthPage />
  </StrictMode>,
)
