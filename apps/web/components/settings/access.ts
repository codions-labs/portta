/** Pure mappings between the concepts shown in Settings and their existing .env representation. */

export type ProjectAccessKind = 'local' | 'private' | 'public'
export type PrivateAccessKind = 'tailscale' | 'interface'
export type PanelAccessKind = 'local' | 'tailscale' | 'public' | 'hostname'
export type PanelHostnameKind = 'subdomain' | 'custom'

export function projectAccessKind(values: Record<string, string | undefined>): ProjectAccessKind {
  if (values.PUBLIC_ENABLED === 'true' || values.PORTTA_PROFILE === 'remote-public') return 'public'
  if (values.TAILSCALE_ENABLED === 'true' || values.PORTTA_PROFILE === 'remote-private') return 'private'
  return 'local'
}

export function projectAccessUpdates(
  kind: ProjectAccessKind,
  baseDomain: string,
  publicDomain = '',
): Record<string, string> {
  if (kind === 'local') {
    return {
      PORTTA_PROFILE: 'local',
      PORTTA_BIND_ADDRESS: '127.0.0.1',
      PUBLIC_ENABLED: 'false',
      TAILSCALE_ENABLED: 'false',
    }
  }
  if (kind === 'private') {
    return {
      PORTTA_PROFILE: 'remote-private',
      PORTTA_BIND_ADDRESS: '127.0.0.1',
      PUBLIC_ENABLED: 'false',
      TAILSCALE_ENABLED: 'true',
    }
  }
  const effectivePublicDomain = publicDomain || (baseDomain !== 'localhost' ? baseDomain : '')
  return {
    PORTTA_PROFILE: 'remote-public',
    PORTTA_BIND_ADDRESS: '0.0.0.0',
    PUBLIC_ENABLED: 'true',
    TAILSCALE_ENABLED: 'false',
    ...(effectivePublicDomain ? { PUBLIC_DOMAIN: effectivePublicDomain } : {}),
  }
}

export function privateAccessKind(values: Record<string, string | undefined>): PrivateAccessKind {
  return values.TAILSCALE_ENABLED === 'true' ? 'tailscale' : 'interface'
}

export function privateAccessUpdates(kind: PrivateAccessKind, currentBind = ''): Record<string, string> {
  if (kind === 'tailscale') {
    return {
      PORTTA_PROFILE: 'remote-private',
      PORTTA_BIND_ADDRESS: '127.0.0.1',
      PUBLIC_ENABLED: 'false',
      TAILSCALE_ENABLED: 'true',
    }
  }
  const bind = ['0.0.0.0', '127.0.0.1', 'localhost', '::1'].includes(currentBind) ? '' : currentBind
  return {
    PORTTA_PROFILE: 'remote-private',
    PORTTA_BIND_ADDRESS: bind,
    PUBLIC_ENABLED: 'false',
    TAILSCALE_ENABLED: 'false',
  }
}

export function panelAccessKind(expose: string): PanelAccessKind {
  if (expose === 'tailscale') return 'tailscale'
  if (expose === 'public') return 'public'
  if (expose === 'vpn' || expose === 'domain') return 'hostname'
  return 'local'
}

export function panelSubdomain(expose: string, advertised: string, configured: string, base: string): string {
  if (expose !== 'domain' || !base || !advertised.endsWith(`.${base}`)) return configured || 'portta-web'
  const prefix = advertised.slice(0, -`.${base}`.length)
  return prefix && !prefix.includes('.') ? prefix : configured || 'portta-web'
}

export function panelHostnameKind(
  expose: string,
  advertised: string,
  subdomain: string,
  base: string,
): PanelHostnameKind {
  if (expose === 'vpn' || !advertised) return 'subdomain'
  if (base && advertised === `${subdomain}.${base}`) return 'subdomain'
  return 'custom'
}

export function panelPreviewUrl(options: {
  expose: string
  port: string
  bind: string
  subdomain: string
  advertised: string
  base: string
  tls: boolean
}): string {
  const port = options.port || '8081'
  const bind = options.bind === '0.0.0.0' || options.bind === '' ? '127.0.0.1' : options.bind
  const bindHost = bind.includes(':') && !bind.startsWith('[') ? `[${bind}]` : bind
  if (options.expose === 'domain') {
    const host = options.advertised || (options.subdomain && options.base ? `${options.subdomain}.${options.base}` : '')
    return host ? `${options.tls ? 'https' : 'http'}://${host}` : ''
  }
  if (options.expose === 'vpn') {
    return `${options.tls ? 'https' : 'http'}://${options.subdomain || 'portta-web'}.${options.base || 'localhost'}`
  }
  if (options.expose === 'public') {
    return options.advertised ? `http://${options.advertised}:${port}` : ''
  }
  return `http://${bindHost}:${port}`
}

export function panelAccessUpdates(options: {
  kind: PanelAccessKind
  hostnameKind: PanelHostnameKind
  subdomain: string
  advertisedHost: string
  port: string
  bind: string
  base: string
  tls: boolean
}): Record<string, string> {
  const port = options.port || '8081'
  const bind = options.bind === '0.0.0.0' || options.bind === '' ? '127.0.0.1' : options.bind

  if (options.kind === 'local') {
    return {
      PORTTA_WEB_EXPOSE: 'local',
      PORTTA_WEB_BIND_ADDRESS: '127.0.0.1',
      PORTTA_PANEL_ADVERTISED_HOST: '127.0.0.1',
      PORTTA_PANEL_URL: `http://127.0.0.1:${port}`,
    }
  }
  if (options.kind === 'tailscale') {
    return {
      PORTTA_WEB_EXPOSE: 'tailscale',
      PORTTA_AUTH_MODE: 'required',
      PORTTA_PANEL_URL: `http://${bind}:${port}`,
    }
  }
  if (options.kind === 'public') {
    const advertisedHost = options.advertisedHost.trim()
    return {
      PORTTA_WEB_EXPOSE: 'public',
      PORTTA_WEB_BIND_ADDRESS: '0.0.0.0',
      PORTTA_AUTH_MODE: 'required',
      PORTTA_PANEL_ADVERTISED_HOST: advertisedHost,
      PORTTA_PANEL_URL: advertisedHost ? `http://${advertisedHost}:${port}` : `http://127.0.0.1:${port}`,
    }
  }

  const subdomain = options.subdomain || 'portta-web'
  if (options.hostnameKind === 'subdomain') {
    const host = `${subdomain}.${options.base || 'localhost'}`
    return {
      PORTTA_AUTH_MODE: 'required',
      PORTTA_WEB_HOST: subdomain,
      PORTTA_PANEL_ADVERTISED_HOST: host,
      PORTTA_WEB_BIND_ADDRESS: '127.0.0.1',
      PORTTA_WEB_EXPOSE: options.tls ? 'domain' : 'vpn',
      PORTTA_PANEL_URL: `${options.tls ? 'https' : 'http'}://${host}`,
    }
  }

  const custom = options.advertisedHost.trim()
  return {
    PORTTA_AUTH_MODE: 'required',
    PORTTA_WEB_EXPOSE: 'domain',
    PORTTA_WEB_BIND_ADDRESS: '127.0.0.1',
    PORTTA_PANEL_ADVERTISED_HOST: custom,
    PORTTA_PANEL_URL: custom ? `${options.tls ? 'https' : 'http'}://${custom}` : '',
  }
}
