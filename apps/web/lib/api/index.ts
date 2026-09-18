// The panel's API client, in one object, so a page imports one name and a test
// mocks one module. The pieces live beside the entity they serve.

import { activityApi } from './activity.ts'
import { adminApi } from './admin.ts'
import { environmentsApi } from './environments.ts'
import { infraApi } from './infra.ts'
import { issuesApi } from './issues.ts'
import { overviewApi } from './overview.ts'
import { projectsApi } from './projects.ts'
import { repositoriesApi } from './repositories.ts'
import { sessionsApi } from './sessions.ts'
import { sshApi } from './ssh.ts'

export type { ActivityFilters } from './activity.ts'
export type { AuditFilters } from './admin.ts'
export { ApiError } from './client.ts'
export type { PatchIssueInput } from './issues.ts'

export const api = {
  ...infraApi,
  ...projectsApi,
  ...environmentsApi,
  ...repositoriesApi,
  ...issuesApi,
  ...sessionsApi,
  ...activityApi,
  ...overviewApi,
  ...adminApi,
  ...sshApi,
}
