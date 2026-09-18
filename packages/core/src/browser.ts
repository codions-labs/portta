// What a browser bundle may import from this package.
//
// `index.ts` re-exports the modules that read the host: config, env, paths,
// password, protections, projects-home, repos-scan. Every one of them pulls
// `node:fs`, so a bundler asked to follow the package's main entry either
// fails or quietly ships a shim. This entry exists so the panel's UI and the
// contract package can share the same derivations the CLI uses — slug,
// hostnames, issue and activity vocabulary, capabilities, pressure — without
// dragging the host in.
//
// The rule for adding a module here: it must not import `node:*`, directly or
// through anything it imports. `tests/unit/boundaries.test.sh` fails if one does.

export * from './activity.ts'
export * from './audit-actions.ts'
export * from './capabilities.ts'
export * from './discovery.ts'
export * from './documentation.ts'
export * from './domain.ts'
export * from './endpoints.ts'
export * from './forge.ts'
export * from './hostname.ts'
export * from './issues.ts'
export * from './metrics.ts'
export * from './namespace.ts'
export * from './pressure.ts'
export {
  applyBranchPattern,
  BRANCH_PATTERN_PLACEHOLDERS,
  BRANCH_TYPES,
  type BranchType,
  isBranchType,
  PROJECT_CONFIG_DEFAULTS,
  proposedIssueBranch,
  slugFromTitle,
} from './project-config.ts'
export * from './project-order.ts'
// Type only. `projects-home` classifies a directory by reading it, which the
// browser cannot do; the vocabulary of that classification is a union, and
// `export type` emits nothing, so naming it here costs no bundle.
export type { ProjectLocation } from './projects-home.ts'
export * from './redact.ts'
export * from './roles.ts'
export * from './route-path.ts'
