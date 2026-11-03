// Which crawlers may read a hostname, kept in the same file the gateway's login service reads.
//
// The default and the exceptions live in the protection store, so a decision takes effect on the
// next request and nothing is restarted. An exception is kept per environment, because that is what
// a record names; a project's exception is written to every environment it has adopted.

import {
  BLOCK_ALL_CRAWLERS,
  type CrawlerPolicy,
  crawlersFor,
  type ProtectionStore,
  readProtectionStore,
  sameCrawlerPolicy,
  setDefaultCrawlers,
  setEnvironmentCrawlers,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { saveProtectionState } from './protection-state.ts'

export function readDefaultCrawlers(config: PanelConfig): CrawlerPolicy {
  return readProtectionStore(config.authStore).crawlers ?? BLOCK_ALL_CRAWLERS
}

export function saveDefaultCrawlers(config: PanelConfig, policy: CrawlerPolicy, adopted: ReadonlySet<string>): void {
  saveProtectionState(
    config,
    forgetStaleExceptions(setDefaultCrawlers(readProtectionStore(config.authStore), policy), adopted),
  )
}

export interface ProjectCrawlerState {
  default: CrawlerPolicy
  own: CrawlerPolicy | null
  effective: CrawlerPolicy
  mixed: boolean
  /** What each environment follows, which is what a verdict per address must use. */
  byEnvironment: Record<string, CrawlerPolicy>
}

/** What a project's environments say: one shared exception, none, or exceptions that disagree. */
export function projectCrawlers(config: PanelConfig, environments: readonly string[]): ProjectCrawlerState {
  const store = readProtectionStore(config.authStore)
  const fallback = store.crawlers ?? BLOCK_ALL_CRAWLERS
  const own = environments.map((name) => store.environments?.[name] ?? null)
  const first = own[0] ?? null
  const mixed = own.some((policy) =>
    first === null || policy === null ? policy !== first : !sameCrawlerPolicy(policy, first),
  )
  const shared = mixed ? null : first
  return {
    default: fallback,
    own: shared,
    effective: shared ?? fallback,
    mixed,
    byEnvironment: Object.fromEntries(environments.map((name) => [name, store.environments?.[name] ?? fallback])),
  }
}

export class NoEnvironmentsToCover extends Error {
  status = 409
  hint = 'adopt an environment first: an exception is kept for the environments a project has'
  constructor() {
    super('this project has no environment yet, so there is nothing for an exception to apply to')
    this.name = 'NoEnvironmentsToCover'
  }
}

/**
 * `null` returns the project to the default.
 *
 * An exception outlives the adoption that gave it meaning, so every save also forgets the
 * exceptions of environments that no project has any more: one that a different project adopts later
 * must not inherit a decision made for the first.
 */
export function saveProjectCrawlers(
  config: PanelConfig,
  environments: readonly string[],
  policy: CrawlerPolicy | null,
  adopted: ReadonlySet<string>,
) {
  if (policy !== null && environments.length === 0) throw new NoEnvironmentsToCover()
  let store = setEnvironmentCrawlers(readProtectionStore(config.authStore), environments, policy)
  store = forgetStaleExceptions(store, adopted)
  saveProtectionState(config, store)
}

/** Drops the exceptions of environments no project has. */
export function forgetStaleExceptions(store: ProtectionStore, adopted: ReadonlySet<string>): ProtectionStore {
  const stale = Object.keys(store.environments ?? {}).filter((name) => !adopted.has(name))
  return stale.length === 0 ? store : setEnvironmentCrawlers(store, stale, null)
}

/** Forgets the exceptions of the environments that just changed hands, and writes only when there were any. */
export function releaseCrawlerExceptions(config: PanelConfig, environments: readonly string[]): void {
  const store = readProtectionStore(config.authStore)
  const held = environments.filter((name) => store.environments?.[name] !== undefined)
  if (held.length > 0) saveProtectionState(config, setEnvironmentCrawlers(store, held, null))
}

/** The policy one environment follows, for the pages that show a verdict per address. */
export function environmentCrawlers(config: PanelConfig, environment: string): CrawlerPolicy {
  return crawlersFor(readProtectionStore(config.authStore), { project: environment })
}
