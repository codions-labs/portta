import { describe, expect, it } from 'vitest'
import { redact, redactSecrets, redactTokens } from './redact.ts'

describe('redacting what we were told about', () => {
  it('replaces every occurrence, longest first', () => {
    expect(redactSecrets('a=hunter2 b=hunter22', ['hunter2', 'hunter22'])).toBe('a=*** b=***')
  })

  it('ignores empty and absent values, which would replace everything', () => {
    expect(redactSecrets('nothing to hide', ['', null, undefined])).toBe('nothing to hide')
  })
})

describe('redacting a Portta token nobody declared', () => {
  // The case that matters: a token in a log line that this process was never
  // handed, because somebody pasted a command into a task note.
  it('finds one by its shape', () => {
    const line = 'curl -H "authorization: Bearer ptt_AbCdEf0123456789xyz" http://127.0.0.1:8081'
    expect(redactTokens(line)).toContain('ptt_***')
    expect(redactTokens(line)).not.toContain('AbCdEf0123456789xyz')
  })

  it('leaves the prefix alone when it is not a token', () => {
    expect(redactTokens('the ptt_ prefix identifies one')).toBe('the ptt_ prefix identifies one')
    expect(redactTokens('ptt_short')).toBe('ptt_short')
  })

  it('does both at once', () => {
    expect(redact('pw=hunter2 token=ptt_AbCdEf0123456789xyz', ['hunter2'])).toBe('pw=*** token=ptt_***')
  })
})
