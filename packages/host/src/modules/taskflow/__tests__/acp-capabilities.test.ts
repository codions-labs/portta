import { describe, expect, it } from 'vitest'
import { normalizeAcpCapabilities, selectPermissionOption } from '../services/acp-agent-session.ts'

describe('ACP capability negotiation', () => {
  it('normalizes optional methods without claiming unsupported behavior', () => {
    expect(
      normalizeAcpCapabilities({
        loadSession: true,
        sessionCapabilities: { resume: {}, fork: {}, list: {} },
        mcpCapabilities: { http: true, sse: false },
      }),
    ).toMatchObject({
      loadSession: true,
      resumeSession: true,
      listSessions: true,
      forkSession: true,
      mcp: { stdio: true, http: true, sse: false },
    })
  })

  it('never grants an always permission and denies unclassified workspace requests', () => {
    const options = [
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'once', name: 'Once', kind: 'allow_once' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ]
    expect(selectPermissionOption('workspace', 'read', options)).toBe('once')
    expect(selectPermissionOption('workspace', 'other', options)).toBe('reject')
    expect(selectPermissionOption('deny', 'read', options)).toBe('reject')
  })
})
