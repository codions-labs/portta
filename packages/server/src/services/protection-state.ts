// Shared synchronous writer for every panel mutation of the ForwardAuth registry.
import { existsSync, readFileSync } from 'node:fs'
import {
  type ProtectionStore,
  parseAliases,
  readProtectionStore,
  renderAliasesForStore,
  renderAuthDynamic,
  writeProtectionStore,
} from 'portta-core'
import type { PanelConfig } from '../config.ts'
import { dynamicPath, GENERATED_FILES, writeGenerated } from './dynamic.ts'

export function saveProtectionState(config: PanelConfig, store: ProtectionStore): void {
  // Suspend an old target before a new service's decision can authorize its
  // hostname. The stored alias remains, so it can return when the conflict ends.
  const aliasPath = dynamicPath(config.dynamicDir, GENERATED_FILES.aliases)
  const aliases = existsSync(aliasPath) ? readFileSync(aliasPath, 'utf8') : null
  const publicHost = config.profile === 'remote-public'
  if (aliases !== null)
    writeGenerated(
      config.dynamicDir,
      GENERATED_FILES.aliases,
      renderAliasesForStore(parseAliases(aliases), store, publicHost, readProtectionStore(config.authStore)),
    )
  writeProtectionStore(config.authStore, store)
  writeGenerated(config.dynamicDir, GENERATED_FILES.auth, renderAuthDynamic(store))
  // An alias that becomes valid again may return only after the conflicting
  // decision has gone, never while that decision can still authorize it.
  if (aliases !== null)
    writeGenerated(
      config.dynamicDir,
      GENERATED_FILES.aliases,
      renderAliasesForStore(parseAliases(aliases), store, publicHost),
    )
}
