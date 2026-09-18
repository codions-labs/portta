export interface AuthConfig {
  host: string
  port: number
  storePath: string
  secret: string
  uiDir: string
  sessionSeconds: number
}

function env(key: string, fallback: string): string {
  return process.env[key] || fallback
}

export function loadAuthConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    host: env('PORTTA_AUTH_HOST', '0.0.0.0'),
    port: Number(env('PORTTA_AUTH_PORT', '4180')),
    storePath: env('PORTTA_AUTH_STORE', '/app/state/auth/protections.json'),
    secret: env('PORTTA_AUTH_SECRET', ''),
    uiDir: env('PORTTA_AUTH_UI_DIR', '/app/apps/auth/dist/ui'),
    sessionSeconds: Number(env('PORTTA_AUTH_SESSION_SECONDS', '43200')),
    ...overrides,
  }
}

export function validateAuthConfig(config: AuthConfig): void {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535)
    throw new Error('invalid PORTTA_AUTH_PORT')
  if (!Number.isInteger(config.sessionSeconds) || config.sessionSeconds < 60)
    throw new Error('invalid PORTTA_AUTH_SESSION_SECONDS')
  if (!/^[A-Fa-f0-9]{64,}$/.test(config.secret))
    throw new Error('PORTTA_AUTH_SECRET must be at least 32 random bytes encoded as hex')
}
