// The Development Dashboard.

import type { DevelopmentOverview } from 'portta-contracts'
import { request } from './client.ts'

export const overviewApi = {
  developmentOverview: () => request<DevelopmentOverview>('/overview'),
}
