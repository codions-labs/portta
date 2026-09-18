import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
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
  next: string
  error: boolean
  protection: {
    label: string
    host: string
    project?: string
    service?: string
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

function AuthPage() {
  const { t } = useTranslation('auth')
  const [visible, setVisible] = useState(false)
  const [pending, setPending] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    if (pending) event.preventDefault()
    else setPending(true)
  }

  return (
    <main className="auth-stage">
      <div className="auth-grid" aria-hidden="true" />
      <section className="auth-intro" aria-label={t('protectedBy')}>
        <div className="auth-brand">
          <PorttaMark />
          <span>PORTTA</span>
        </div>
        <div className="auth-kicker">
          <ShieldCheck className="h-4 w-4" />
          {t('protectedAccess')}
        </div>
        <h1>{t('heading')}</h1>
        <p>{t('explanation')}</p>
        <div className="auth-seal">
          <span>01</span>
          <span>{t('proxyBoundary')}</span>
        </div>
      </section>

      <section className="auth-card" aria-labelledby="destination-name">
        <div className="auth-card-rail" aria-hidden="true">
          <span>AUTH</span>
          <span>4180</span>
        </div>
        <div className="auth-card-body">
          <div className="auth-destination">
            <div className="auth-service-icon">
              {context.protection.tech ? (
                <ServiceIcon tech={context.protection.tech} className="[&>svg]:h-6 [&>svg]:w-6" />
              ) : (
                <LockKeyhole className="h-6 w-6" aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="auth-eyebrow">{t('destination')}</p>
              <h2 id="destination-name">{context.protection.label}</h2>
              <p className="auth-host">{context.protection.host}</p>
            </div>
          </div>

          {(context.protection.project || context.protection.service) && (
            <dl className="auth-meta">
              {context.protection.project && (
                <div>
                  <dt>{t('project')}</dt>
                  <dd>{context.protection.project}</dd>
                </div>
              )}
              {context.protection.service && (
                <div>
                  <dt>{t('service')}</dt>
                  <dd>{context.protection.service}</dd>
                </div>
              )}
            </dl>
          )}

          <form method="post" action="/__portta/auth/login" onSubmit={submit} className="auth-form">
            <input type="hidden" name="next" value={context.next} />
            <div className="auth-field">
              <label htmlFor="user">{t('username')}</label>
              <Input id="user" name="user" autoComplete="username" required autoFocus spellCheck={false} />
            </div>
            <div className="auth-field">
              <label htmlFor="password">{t('password')}</label>
              <div className="auth-password">
                <Input
                  id="password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
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
            {context.error && (
              <p className="auth-error" role="alert">
                {t('invalid')}
              </p>
            )}
            <Button type="submit" variant="primary" size="md" disabled={pending} className="auth-submit">
              {pending ? (
                <span className="auth-spinner" aria-hidden="true" />
              ) : (
                <LockKeyhole className="h-4 w-4" aria-hidden="true" />
              )}
              {pending ? t('signingIn') : t('signIn')}
            </Button>
          </form>

          <p className="auth-footer">
            <ShieldCheck aria-hidden="true" />
            {t('protectedBy')}
          </p>
        </div>
      </section>
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
