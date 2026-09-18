import type { TFunction } from 'i18next'

const VALIDATION_MAP: Record<string, string> = {
  'must be a hostname, for example dev.example.com': 'validation.mustBeHostname',
  'must be a port between 1 and 65535': 'validation.mustBePort',
  'must be an IPv4 address': 'validation.mustBeIpv4',
  'must be an email address': 'validation.mustBeEmail',
  'must be an https URL': 'validation.mustBeHttpsUrl',
  'must be a URL': 'validation.mustBeUrl',
  'is not a setting the panel manages': 'validation.notManaged',
  'must be true or false': 'validation.mustBeBoolean',
  'is required by the remote-public profile': 'validation.publicDomainRequired',
  'the remote-private profile must not bind 0.0.0.0': 'validation.bindAddressPrivate',
  'is required when TLS_MODE is acme': 'validation.acmeEmailRequired',
  'is required when Tailscale is enabled': 'validation.tailscaleHostnameRequired',
  'the panel is not published on every interface; reach it over the VPN instead': 'validation.panelNotOnEveryInterface',
}

const HINT_MAP: Record<string, string> = {
  'the value was not saved': 'hints.notSaved',
  'existing Docker-backed pages remain available; run portta db status': 'hints.databaseUnavailable',
  'this is a panel limit, not a Docker one': 'hints.panelLimit',
  'unexpected failure': 'hints.unexpected',
}

const ERROR_MAP: Record<string, string> = {
  'the panel is running in read-only mode': 'readOnly',
  'cross-origin writes are refused': 'crossOrigin',
  'bridge closed; the service itself was not touched': 'bridgeClosed',
}

type LooseT = TFunction | ((key: string, options?: Record<string, unknown>) => string)

function loose(t: LooseT, key: string, options?: Record<string, unknown>): string {
  return (t as (key: string, options?: Record<string, unknown>) => string)(key, options)
}

/** Translates known API error strings; falls back to the original text. */
export function translateApiError(error: string, _hint?: string, t?: LooseT): string {
  if (!t) return error

  const mapped = ERROR_MAP[error]
  if (mapped) return loose(t, mapped, { ns: 'errors' })

  const colon = error.indexOf(': ')
  if (colon > 0) {
    const key = error.slice(0, colon)
    const reason = error.slice(colon + 2)
    if (reason.startsWith('must be one of ')) {
      const choices = reason.slice('must be one of '.length)
      return `${key}: ${loose(t, 'validation.mustBeOneOf', { ns: 'settings', choices })}`
    }
    const validationKey = VALIDATION_MAP[reason]
    if (validationKey) return `${key}: ${loose(t, validationKey, { ns: 'settings' })}`
  }

  return error
}

export function translateApiHint(hint: string, t?: LooseT): string {
  if (!t) return hint
  const key = HINT_MAP[hint]
  return key ? loose(t, key, { ns: 'errors' }) : hint
}
