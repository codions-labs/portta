// The registered modules, resolved on the server.
//
// Every module the build has is on; a Client Component learns the ids from
// `ModulesProvider` rather than importing the registry, so the list is decided
// in one place per render.

import { notFound } from 'next/navigation'
import { WEB_MODULES, type WebModule } from '@/modules'

export function registeredModuleIds(modules: readonly WebModule[] = WEB_MODULES): string[] {
  return modules.map((module) => module.manifest.id)
}

/**
 * A page that belongs to a module, answered only while the build has it.
 *
 * `notFound()` for the same reason `pageNeeds` gives one: a module this build
 * does not carry is not part of this panel, and its pages are not doors with a
 * sign on them.
 */
export function pageNeedsModule(id: string): void {
  if (!registeredModuleIds().includes(id)) notFound()
}
