// What an audit entry can say happened.
//
// A closed list, here rather than beside the writer, because three packages
// need to agree on it: the service that writes one, the contract the API
// publishes, and the page that filters by it. A vocabulary with three
// definitions is three vocabularies.
//
// Issues, sessions and commits are development activity and are not in it:
// `activity_events` is the work record, and this is the sensitive writes.
// See docs/development/adr/0035-authentication-lives-in-the-panel.md and 03 §9.

export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.logout',
  'auth.login_failed',
  'user.created',
  'user.deleted',
  'user.role_changed',
  'user.banned',
  'user.unbanned',
  'user.password_set',
  'user.password_changed',
  'user.ownership_transferred',
  'user.two_factor_enabled',
  'user.two_factor_disabled',
  'user.sessions_revoked',
  'project_access.granted',
  'project_access.revoked',
  'token.created',
  'token.revoked',
  'project.created',
  'project.updated',
  'project.deleted',
  'environment.started',
  'environment.stopped',
  'environment.restarted',
  'environment.rebuilt',
  'environment.destroyed',
  'environment.forgotten',
  'service.restarted',
  'container.operated',
  'container.destroyed',
  'access.bridge_opened',
  'access.bridge_closed',
  'share.created',
  'share.revoked',
  'gateway.applied',
  'settings.changed',
  'settings.discarded',
  'database.migrated',
  'ssh.key_created',
  'ssh.key_imported',
  'ssh.key_removed',
  'ssh.key_tested',
  'container.console_opened',
  'container.console_closed',
] as const

export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === 'string' && (AUDIT_ACTIONS as readonly string[]).includes(value)
}
