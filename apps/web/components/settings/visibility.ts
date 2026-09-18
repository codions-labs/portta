/**
 * Which catalogue keys belong on the current form.
 *
 * The API still returns every key so a save can write derived ones. The page
 * hides what the current mode does not ask the operator to decide.
 */
const HIDDEN = new Set(['PORTTA_WEB_HOST', 'PORTTA_PANEL_ADVERTISED_HOST', 'PORTTA_PANEL_URL', 'PORTTA_WEB_EXPOSE'])

export function isFieldVisible(key: string, values: Record<string, string>): boolean {
  if (HIDDEN.has(key)) return false

  const mode = values.PORTTA_DOMAIN_MODE || 'local'
  const publicOn = values.PUBLIC_ENABLED === 'true'
  const tlsOn = values.TLS_ENABLED === 'true'
  const tlsMode = values.TLS_MODE || 'local'
  const challenge = values.ACME_CHALLENGE || 'dns'
  const tailscaleOn = values.TAILSCALE_ENABLED === 'true'
  const cloudflareOn = values.CLOUDFLARE_ENABLED === 'true'
  const dashboardOn = values.PORTTA_DASHBOARD === 'true'

  switch (key) {
    case 'PORTTA_PUBLIC_IP':
    case 'PORTTA_AUTO_DOMAIN_PROVIDER':
      return mode === 'auto'
    case 'PORTTA_DOMAIN':
      return mode === 'custom'
    case 'PUBLIC_DOMAIN':
      return publicOn
    case 'TAILSCALE_HOSTNAME':
    case 'TS_AUTHKEY':
    case 'PRIVATE_DOMAIN':
      return tailscaleOn
    case 'TLS_MODE':
      return tlsOn
    case 'ACME_EMAIL':
    case 'ACME_CHALLENGE':
    case 'ACME_CA_SERVER':
      return tlsOn && tlsMode === 'acme'
    case 'ACME_DNS_PROVIDER':
      return tlsOn && tlsMode === 'acme' && challenge === 'dns'
    case 'CLOUDFLARE_ZONE':
    case 'CF_DNS_API_TOKEN':
      return cloudflareOn
    case 'PORTTA_DASHBOARD_PORT':
      return dashboardOn
    default:
      return true
  }
}

export const PANEL_SECTIONS = {
  network: ['PORTTA_WEB_PORT', 'PORTTA_WEB_BIND_ADDRESS'],
  security: ['PORTTA_WEB_READ_ONLY', 'PORTTA_AUTH_MODE', 'PORTTA_AUTH_SECRET', 'PORTTA_PANEL_TRUSTED_ORIGINS'],
  features: ['PORTTA_RUNTIME_DOCS', 'PORTTA_RUNTIME_API_DOCS'],
} as const
