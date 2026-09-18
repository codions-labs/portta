import type { EnvironmentReport } from 'portta-core'
import { environmentReportFile } from '../metrics/paths.js'
import { writeAtomic } from '../metrics/store.js'

export function writeEnvironmentReport(root: string, report: EnvironmentReport): string {
  const path = environmentReportFile(root)
  writeAtomic(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}
