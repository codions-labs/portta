// The official modules, composed at build time.
//
// One static list, and the only way a module reaches the shared vocabularies:
// `ACTIVITY_KINDS` and the permission statements in `packages/auth` are the
// base lists followed by what the manifests here add. Each layer has a
// registry of its own beside this one (`packages/server/src/modules`,
// `packages/cli/src/modules`, `apps/web/modules`) naming the same manifests.
//
// Declared `as const` so the tuple keeps each manifest's literal types: an
// empty list adds nothing to any union, and a module added here extends them.
// See docs/development/adr/0046-official-modules-are-composed-at-build-time.md.

import type { ModuleManifest } from './manifest.ts'
import { taskflowModule } from './taskflow.ts'

export * from './manifest.ts'
export { taskflowModule } from './taskflow.ts'

export const MODULES = [taskflowModule] as const satisfies readonly ModuleManifest[]
