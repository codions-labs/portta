import { join } from 'node:path'
import type { EnvironmentReport } from 'portta-core'
import { writeAtomic } from '../../metrics/store.js'

export function securityReportFile(root: string): string {
  return join(root, 'state/environment/security.json')
}

export function writeHostSecurityReport(root: string, report: EnvironmentReport): string {
  const path = securityReportFile(root)
  writeAtomic(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}
