// What an official module declares about itself, before any layer composes it.
//
// A module is a vertical slice of Portta that is compiled in and always on:
// whether it is present is a build decision, never an operator setting. It has
// no package of its own: each layer keeps its part under a `modules/` folder
// and lists it in that layer's static registry. This manifest is the part every
// layer shares — the identity, the permissions it adds to the vocabulary, the
// activity kinds it records and where its documentation lives — so no layer
// restates it.
//
// Framework-agnostic on purpose. The panel, the CLI and a browser bundle all
// read this file, so it imports nothing but the role vocabulary.

import type { Role } from '../roles.ts'

/** `resource -> actions`, the shape of an access-control statement. */
export type ModulePermissions = { readonly [resource: string]: readonly string[] }

/** A subset of a module's own statements, granted to one role. */
export type ModuleGrants<P extends ModulePermissions> = { readonly [R in keyof P]?: readonly P[R][number][] }

/**
 * The roles a module may grant to by default.
 *
 * `owner` and `admin` hold every statement by construction, and an agent's
 * default is derived from `developer`, so those three are never listed here.
 */
export type ModuleRole = Extract<Role, 'developer' | 'viewer'>

export interface ModuleManifest<
  Id extends string = string,
  P extends ModulePermissions = ModulePermissions,
  K extends string = string,
> {
  /** Lowercase, and the path segment the module answers under: `/api/modules/<id>`. */
  readonly id: Id
  /** What an operator reads. */
  readonly name: string
  /** Resources and actions this module adds to the permission vocabulary. */
  readonly permissions: P
  /** What `developer` and `viewer` hold of those statements unless changed. */
  readonly roles?: { readonly [R in ModuleRole]?: ModuleGrants<P> }
  /** Activity kinds this module records, as `entity.verb`. */
  readonly activityKinds: readonly K[]
  /** The directory holding this module's pages and their `navigation.json`, such as `docs/modules/taskflow`. */
  readonly docs?: string
}

const ID = /^[a-z][a-z0-9-]*$/
const KIND = /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/

/**
 * Declare a module, keeping every literal in its type.
 *
 * The registries derive types from the manifests they list — a permission
 * name, an activity kind — so a manifest that widened to `string` would widen
 * the whole vocabulary with it. A malformed manifest is refused at load, where
 * the stack names the module, rather than when a route first reads it.
 */
export function defineModule<const Id extends string, const P extends ModulePermissions, const K extends string>(
  manifest: ModuleManifest<Id, P, K>,
): ModuleManifest<Id, P, K> {
  if (!ID.test(manifest.id)) throw new Error(`module id must be lowercase letters, digits and dashes: ${manifest.id}`)
  for (const kind of manifest.activityKinds) {
    if (!KIND.test(kind)) throw new Error(`module ${manifest.id}: activity kind must be entity.verb: ${kind}`)
  }
  for (const [role, grants] of Object.entries(manifest.roles ?? {})) {
    for (const [resource, actions] of Object.entries(grants ?? {})) {
      const known = manifest.permissions[resource]
      const unknown = (actions as readonly string[]).filter((action) => !known?.includes(action))
      if (!known || unknown.length > 0)
        throw new Error(
          `module ${manifest.id}: ${role} is granted ${resource}:${unknown.join(',') || '*'}, which the module does not declare`,
        )
    }
  }
  return manifest
}

/**
 * A base vocabulary followed by what modules add, refusing a name twice.
 *
 * A module reusing a base name would silently share its meaning — a permission
 * that grants two things, an activity kind two features emit — so it is a
 * load-time error instead.
 */
export function extendVocabulary<T extends string>(base: readonly T[], added: readonly string[], what: string): T[] {
  const seen = new Set<string>(base)
  for (const name of added) {
    if (seen.has(name)) throw new Error(`duplicate ${what} contributed by a module: ${name}`)
    seen.add(name)
  }
  return [...base, ...added] as T[]
}

/** Every activity kind a registry of manifests adds. */
export function moduleActivityKinds(modules: readonly ModuleManifest[]): string[] {
  return modules.flatMap((module) => [...module.activityKinds])
}

/** Every statement a registry of manifests adds, refusing a resource two modules both claim. */
export function modulePermissions(modules: readonly ModuleManifest[]): Record<string, readonly string[]> {
  const merged: Record<string, readonly string[]> = {}
  for (const module of modules) {
    for (const [resource, actions] of Object.entries(module.permissions)) {
      if (merged[resource])
        throw new Error(`module ${module.id}: resource ${resource} is already declared by another module`)
      merged[resource] = actions
    }
  }
  return merged
}

/** What one role holds of every module's statements. */
export function moduleRoleGrants(
  modules: readonly ModuleManifest[],
  role: ModuleRole,
): Record<string, readonly string[]> {
  const merged: Record<string, readonly string[]> = {}
  for (const module of modules) Object.assign(merged, module.roles?.[role] ?? {})
  return merged
}

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void
  ? I
  : never

/** The activity kinds a tuple of manifests adds, as a union. `never` for none. */
export type ModuleActivityKind<M extends readonly ModuleManifest[]> = M[number]['activityKinds'][number]

/** The statements a tuple of manifests adds, as one object type. Empty for none. */
export type ModuleStatements<M extends readonly ModuleManifest[]> = [M[number]] extends [never]
  ? Record<never, never>
  : UnionToIntersection<M[number]['permissions']>
