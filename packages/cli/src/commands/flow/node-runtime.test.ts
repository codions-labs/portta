import { describe, expect, it } from 'vitest'
import { isSupportedNodeVersion, MIN_NODE_MAJOR, parseNodeMajor } from './node-runtime.ts'

describe('node runtime helpers', () => {
  it('accepts Node 24+ and rejects older majors', () => {
    expect(MIN_NODE_MAJOR).toBe(24)
    expect(parseNodeMajor('v24.5.0')).toBe(24)
    expect(parseNodeMajor('22.22.1')).toBe(22)
    expect(isSupportedNodeVersion('v24.5.0')).toBe(true)
    expect(isSupportedNodeVersion('v22.22.1')).toBe(false)
  })
})
