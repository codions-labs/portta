import { describe, expect, it } from 'vitest'
import { log, redactSecrets } from '../lib/log.ts'

describe('log redaction', () => {
  it('does not print presented tokens', () => {
    const lines: string[] = []
    const original = console.log
    console.log = (message?: unknown, ...rest: unknown[]) => {
      lines.push([message, ...rest].map(String).join(' '))
    }
    try {
      log.info('upgrade /ws/x Authorization: Bearer super-secret-value')
    } finally {
      console.log = original
    }
    expect(lines.join('\n')).not.toContain('super-secret-value')
    expect(lines.join('\n')).toContain('Bearer [REDACTED]')
  })
})

describe('redactSecrets', () => {
  it('redacts bearer tokens and control-token assignments', () => {
    expect(redactSecrets('Authorization: Bearer super-secret-value')).toBe('Authorization: Bearer [REDACTED]')
    expect(redactSecrets('PORTTA_FLOW_CONTROL_TOKEN=super-secret-value')).toBe('PORTTA_FLOW_CONTROL_TOKEN=[REDACTED]')
    expect(redactSecrets('no secrets here')).toBe('no secrets here')
  })
})
