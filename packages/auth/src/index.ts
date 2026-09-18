// Who is asking, and what they may do.
//
// The panel has exactly one answer to both questions, and it is this package.
// `packages/server` decides what a route needs; this decides whether the person
// asking has it.

export {
  AGENT_DEFAULT_PERMISSIONS,
  ac,
  fromStatements,
  isPermission,
  PERMISSIONS,
  type Permission,
  permissionsOf,
  READ_PERMISSIONS,
  type Resource,
  ROLES,
  type Role,
  roles,
  statements,
  toStatements,
} from './access-control.ts'
export {
  type CreateTokenInput,
  collectTokens,
  createToken,
  findToken,
  listTokens,
  revokeToken,
  scopesFor,
  TOKEN_PREFIX,
  type TokenDeps,
  type TokenRecord,
  TokenRefused,
} from './api-tokens.ts'
export { type Auth, type AuthDeps, createAuth } from './auth.ts'
export {
  authorize,
  can,
  Forbidden,
  type Principal,
  type PrincipalKind,
  refusalForBan,
  refusalForRemoval,
  refusalForRoleChange,
  refusalForTransfer,
  refusalForUserWrite,
  type Scope,
  sees,
  Unauthenticated,
  type UserSubject,
} from './authorize.ts'
export {
  type BootstrapInput,
  bootstrapOwner,
  hasOwner,
  SetupClosed,
  type SetupStatus,
  setupStatus,
} from './bootstrap.ts'
export {
  createPrincipalResolver,
  LOCAL_PRINCIPAL_NAME,
  type PrincipalResolver,
  principalFor,
  type ResolverDeps,
} from './principal.ts'
export {
  ConfigError,
  resolveSecurityMode,
  type SecurityConfig,
  type SecurityMode,
  trustedOrigins,
  useSecureCookies,
} from './security-mode.ts'
