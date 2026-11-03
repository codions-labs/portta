// Which crawlers may read a hostname, kept in the same file the gateway's login service reads.
//
// The default and the exceptions live in the protection store, so a decision takes effect on the
// next request and nothing is restarted. An exception is kept per environment, because that is what
// a record names; a project's exception is written to every environment it has adopted.

import {
  BLOCK_ALL_CRAWLERS,
  type CrawlerPolicy,
  crawlersFor,
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

export function saveDefaultCrawlers(config: PanelConfig, policy: CrawlerPolicy): void {
  saveProtectionState(config, setDefaultCrawlers(readProtectionStore(config.authStore), policy))
}

export interface ProjectCrawlerState {
  default: CrawlerPolicy
  own: CrawlerPolicy | null
  effective: CrawlerPolicy
  mixed: boolean
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
  }
}

/** `null` returns the project to the default. */
export function saveProjectCrawlers(
  config: PanelConfig,
  environments: readonly string[],
  policy: CrawlerPolicy | null,
) {
  saveProtectionState(config, setEnvironmentCrawlers(readProtectionStore(config.authStore), environments, policy))
}

/** The policy one environment follows, for the pages that show a verdict per address. */
export function environmentCrawlers(config: PanelConfig, environment: string): CrawlerPolicy {
  return crawlersFor(readProtectionStore(config.authStore), { project: environment })
}
