import type { DiagnosticsResponse } from 'portta-contracts/taskflow'
import { flowApi } from './daemon.ts'
import { formatServerError, resolveProjectBaseUrl, withServerConnection } from './shared.ts'

interface DoctorDependencies {
  resolveBaseUrl?: (port: number, projectDir: string) => Promise<string>
  fetchDiagnostics?: (baseUrl: string) => Promise<DiagnosticsResponse>
  stdout?: (message: string) => void
  stderr?: (message: string) => void
}

export async function runDoctorCommand(
  options: { json: boolean },
  port: number,
  projectDir = process.cwd(),
  deps: DoctorDependencies = {},
): Promise<number> {
  try {
    const { json } = options
    const baseUrl = await (deps.resolveBaseUrl ?? resolveProjectBaseUrl)(port, projectDir)
    const result = await withServerConnection(port, () =>
      deps.fetchDiagnostics ? deps.fetchDiagnostics(baseUrl) : flowApi(baseUrl).fetchDiagnostics(),
    )
    const stdout = deps.stdout ?? console.log
    if (json) {
      stdout(JSON.stringify(result, null, 2))
      return result.ready ? 0 : 1
    }

    stdout(`Environment diagnostics (${result.ready ? 'ready' : 'action required'})`)
    for (const item of result.checks) {
      const marker =
        item.status === 'ok' ? '✓' : item.status === 'skipped' ? '–' : item.status === 'warning' ? '!' : '✗'
      stdout(`${marker} ${item.label}: ${item.summary}`)
      if (item.remediation) stdout(`  ${item.remediation}`)
    }
    return result.ready ? 0 : 1
  } catch (error) {
    ;(deps.stderr ?? console.error)(`Error: ${formatServerError(error, port)}`)
    return 1
  }
}
