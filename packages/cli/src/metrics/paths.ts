import { join } from 'node:path'

export function metricsDir(root: string): string {
  return join(root, 'state/metrics')
}

export function currentFile(root: string): string {
  return join(metricsDir(root), 'current.json')
}

export function historyFile(root: string): string {
  return join(metricsDir(root), 'history.jsonl')
}

export function instanceFile(root: string): string {
  return join(metricsDir(root), 'instance.json')
}

export function pidFile(root: string): string {
  return join(metricsDir(root), 'collector.pid')
}

export function logFile(root: string): string {
  return join(root, 'state/logs/host-metrics.log')
}

export function environmentReportFile(root: string): string {
  return join(root, 'state/environment/report.json')
}
