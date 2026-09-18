import { join } from 'node:path'
import type { SecurityReport } from 'portta-contracts'
import type { PanelConfig } from '../config.ts'
import { readHostReportFile } from './environment.ts'

export function readHostSecurityReport(config: PanelConfig, now = Date.now()): SecurityReport {
  return readHostReportFile(join(config.environmentDir, 'security.json'), config.environmentStaleSeconds, now)
}
