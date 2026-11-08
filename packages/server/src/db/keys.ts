import { z } from 'portta-core/zod'

export class UnknownSettingKey extends Error {
  constructor(scope: string, key: string) {
    super(`${key} is not a ${scope} setting the panel stores`)
    this.name = 'UnknownSettingKey'
  }
}

export const GLOBAL_KEYS = {
  theme: z.enum(['system', 'light', 'dark']),
  defaultPage: z.enum(['overview', 'projects', 'docker', 'access', 'network', 'gateway', 'settings']),
  tableDensity: z.enum(['comfortable', 'compact']),
} as const

export const ENVIRONMENT_KEYS = {
  displayName: z.string().min(1).max(120),
  description: z.string().max(2000),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  pinned: z.boolean(),
  archived: z.boolean(),
  primaryService: z.string().min(1).max(128),
  hiddenServices: z.array(z.string().min(1).max(128)).max(256),
  serviceOrder: z.array(z.string().min(1).max(128)).max(256),
} as const

const HOSTNAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/

/**
 * `alias` is the first version of this setting: one whole hostname. `aliases` replaced it when a
 * service could have several, including domains the user pointed at the gateway. Both are read,
 * only `aliases` is written, and the hostnames are shape-checked here; whether the gateway will
 * route one is decided in services/overrides.ts, where the configuration is.
 */
export const SERVICE_KEYS = {
  alias: z.string().min(1).max(253).regex(HOSTNAME_PATTERN),
  aliases: z.array(z.string().min(1).max(253).regex(HOSTNAME_PATTERN)).min(1).max(10),
  note: z.string().max(2000),
  hidden: z.boolean(),
} as const

export type GlobalSettingKey = keyof typeof GLOBAL_KEYS
export type EnvironmentSettingKey = keyof typeof ENVIRONMENT_KEYS
export type ServiceSettingKey = keyof typeof SERVICE_KEYS

export type GlobalSettingValues = {
  [K in GlobalSettingKey]: z.output<(typeof GLOBAL_KEYS)[K]>
}
export type EnvironmentSettingValues = {
  [K in EnvironmentSettingKey]: z.output<(typeof ENVIRONMENT_KEYS)[K]>
}
export type ServiceSettingValues = {
  [K in ServiceSettingKey]: z.output<(typeof SERVICE_KEYS)[K]>
}

function schemaFor<T extends Record<string, z.ZodType>>(scope: string, catalogue: T, key: string): z.ZodType {
  const schema = catalogue[key]
  if (schema === undefined) throw new UnknownSettingKey(scope, key)
  return schema
}

export function globalSchema(key: string): z.ZodType {
  return schemaFor('global', GLOBAL_KEYS, key)
}

export function environmentSchema(key: string): z.ZodType {
  return schemaFor('environment', ENVIRONMENT_KEYS, key)
}

export function serviceSchema(key: string): z.ZodType {
  return schemaFor('service', SERVICE_KEYS, key)
}
