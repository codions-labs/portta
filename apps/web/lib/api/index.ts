// The panel's API client, in one object, so a page imports one name and a test
// mocks one module. The pieces live beside the entity they serve.

import { adminApi } from './admin.ts'
import { environmentsApi } from './environments.ts'
import { infraApi } from './infra.ts'
import { overviewApi } from './overview.ts'
import { projectsApi } from './projects.ts'

export type { AuditFilters } from './admin.ts'
export { ApiError } from './client.ts'

export const api = {
  ...infraApi,
  ...projectsApi,
  ...environmentsApi,
  ...overviewApi,
  ...adminApi,
}
