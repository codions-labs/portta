import type { DiagnosticsResponse } from 'portta-contracts/taskflow'
import { describe, expect, it } from 'vitest'
import { runDoctorCommand } from './doctor.ts'

const RESPONSE: DiagnosticsResponse = {
  ready: false,
  checkedAt: '2026-09-10T12:00:00.000Z',
  checks: [
    { id: 'git', label: 'Git', status: 'ok', required: true, summary: 'git version 2.0', remediation: null },
    {
      id: 'linear',
      label: 'Linear',
      status: 'error',
      required: true,
      summary: 'LINEAR_API_KEY is not configured',
      remediation: 'Configure the key',
    },
  ],
}

describe('doctor command', () => {
  it('prints actionable checks and fails when required capabilities are unavailable', async () => {
    const output: string[] = []
    const result = await runDoctorCommand({ json: false }, 5111, '/repo', {
      resolveBaseUrl: async () => 'http://localhost:5111/project',
      fetchDiagnostics: async () => RESPONSE,
      stdout: (message) => output.push(message),
    })

    expect(result).toBe(1)
    expect(output.join('\n')).toContain('Git: git version 2.0')
    expect(output.join('\n')).toContain('Configure the key')
  })

  it('supports machine-readable JSON output', async () => {
    const output: string[] = []
    await runDoctorCommand({ json: true }, 5111, '/repo', {
      resolveBaseUrl: async () => 'http://localhost:5111/project',
      fetchDiagnostics: async () => ({ ...RESPONSE, ready: true }),
      stdout: (message) => output.push(message),
    })

    expect(JSON.parse(output.join('\n'))).toMatchObject({ ready: true })
  })

  it('reports project resolution errors without throwing a stack trace', async () => {
    const errors: string[] = []
    const result = await runDoctorCommand({ json: false }, 5111, '/repo', {
      resolveBaseUrl: async () => {
        throw new Error('project is not served')
      },
      stderr: (message) => errors.push(message),
    })

    expect(result).toBe(1)
    expect(errors).toEqual(['Error: project is not served'])
  })
})
