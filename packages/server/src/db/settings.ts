// The operator's settings, at three scopes: the installation, an environment,
// one service inside an environment.
//
// A stored value that no longer matches its declared schema is read as absent
// rather than trusted, so a key whose shape changed degrades to its default
// instead of reaching a service as the wrong type.

import { and, eq, sql } from 'drizzle-orm'
import { type Db, environmentSettings, environments, serviceSettings, settings } from 'portta-db'
import {
  type EnvironmentSettingKey,
  type EnvironmentSettingValues,
  environmentSchema,
  type GlobalSettingKey,
  type GlobalSettingValues,
  globalSchema,
  type ServiceSettingKey,
  type ServiceSettingValues,
  serviceSchema,
} from './keys.ts'

/** Milliseconds from SQLite's own clock, matching what the schema defaults to. */
const NOW = sql`(CAST(unixepoch('subsec') * 1000 AS INTEGER))`

export interface EnvironmentSettingRow {
  composeProject: string
  key: string
  value: unknown
}

export interface ServiceSettingRow {
  composeProject: string
  service: string
  key: string
  value: unknown
}

function validOrNull<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: unknown } },
  value: unknown,
): T | null {
  const parsed = schema.safeParse(value)
  return parsed.success ? (parsed.data as T) : null
}

export class SettingsRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async getGlobal<K extends GlobalSettingKey>(key: K): Promise<GlobalSettingValues[K] | null> {
    const [row] = await this.db.select({ value: settings.value }).from(settings).where(eq(settings.key, key))
    return validOrNull(globalSchema(key), row?.value ?? null)
  }

  async setGlobal<K extends GlobalSettingKey>(key: K, value: GlobalSettingValues[K]): Promise<void> {
    const parsed = globalSchema(key).parse(value)
    await this.db
      .insert(settings)
      .values({ key, value: parsed })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: sql`excluded.value`, updatedAt: NOW },
      })
  }

  async getEnvironment<K extends EnvironmentSettingKey>(
    environmentId: string,
    key: K,
  ): Promise<EnvironmentSettingValues[K] | null> {
    const [row] = await this.db
      .select({ value: environmentSettings.value })
      .from(environmentSettings)
      .where(and(eq(environmentSettings.environmentId, Number(environmentId)), eq(environmentSettings.key, key)))
    return validOrNull(environmentSchema(key), row?.value ?? null)
  }

  async setEnvironment<K extends EnvironmentSettingKey>(
    environmentId: string,
    key: K,
    value: EnvironmentSettingValues[K],
  ): Promise<void> {
    const parsed = environmentSchema(key).parse(value)
    await this.db
      .insert(environmentSettings)
      .values({ environmentId: Number(environmentId), key, value: parsed })
      .onConflictDoUpdate({
        target: [environmentSettings.environmentId, environmentSettings.key],
        set: { value: sql`excluded.value`, updatedAt: NOW },
      })
  }

  async getService<K extends ServiceSettingKey>(
    environmentId: string,
    service: string,
    key: K,
  ): Promise<ServiceSettingValues[K] | null> {
    const [row] = await this.db
      .select({ value: serviceSettings.value })
      .from(serviceSettings)
      .where(
        and(
          eq(serviceSettings.environmentId, Number(environmentId)),
          eq(serviceSettings.service, service),
          eq(serviceSettings.key, key),
        ),
      )
    return validOrNull(serviceSchema(key), row?.value ?? null)
  }

  async setService<K extends ServiceSettingKey>(
    environmentId: string,
    service: string,
    key: K,
    value: ServiceSettingValues[K],
  ): Promise<void> {
    const parsed = serviceSchema(key).parse(value)
    await this.db
      .insert(serviceSettings)
      .values({ environmentId: Number(environmentId), service, key, value: parsed })
      .onConflictDoUpdate({
        target: [serviceSettings.environmentId, serviceSettings.service, serviceSettings.key],
        set: { value: sql`excluded.value`, updatedAt: NOW },
      })
  }

  /** Forget a global setting, so whatever reads it falls back to its default. */
  async clearGlobal(key: GlobalSettingKey): Promise<void> {
    await this.db.delete(settings).where(eq(settings.key, key))
  }

  async clearEnvironment(environmentId: string, key: EnvironmentSettingKey): Promise<void> {
    await this.db
      .delete(environmentSettings)
      .where(and(eq(environmentSettings.environmentId, Number(environmentId)), eq(environmentSettings.key, key)))
  }

  async clearService(environmentId: string, service: string, key: ServiceSettingKey): Promise<void> {
    await this.db
      .delete(serviceSettings)
      .where(
        and(
          eq(serviceSettings.environmentId, Number(environmentId)),
          eq(serviceSettings.service, service),
          eq(serviceSettings.key, key),
        ),
      )
  }

  /**
   * Every stored override, in one query rather than one per environment.
   *
   * Decorating a snapshot must not cost a round trip per environment: the panel
   * rebuilds the snapshot on every Docker event, and a per-environment fan-out
   * would turn a quiet host into a busy database.
   */
  listAllEnvironment(): Promise<EnvironmentSettingRow[]> {
    return this.db
      .select({
        composeProject: environments.composeProject,
        key: environmentSettings.key,
        value: environmentSettings.value,
      })
      .from(environmentSettings)
      .innerJoin(environments, eq(environments.id, environmentSettings.environmentId))
  }

  listAllService(): Promise<ServiceSettingRow[]> {
    return this.db
      .select({
        composeProject: environments.composeProject,
        service: serviceSettings.service,
        key: serviceSettings.key,
        value: serviceSettings.value,
      })
      .from(serviceSettings)
      .innerJoin(environments, eq(environments.id, serviceSettings.environmentId))
  }
}
