import { describe, expect, it } from 'vitest'
import { parseTunnelRecord, renderTunnelRecord, type TunnelRecord } from './remote.js'

const record: TunnelRecord = {
  id: 'a1b2c3',
  pid: 1234,
  target: 'deploy@example.test',
  project: 'storefront',
  service: 'postgres',
  remotePort: 49153,
  localPort: 49154,
  started: 1_800_000_000,
}

describe('remote tunnel records', () => {
  it('rejects another id and malformed records', () => {
    expect(parseTunnelRecord('different', renderTunnelRecord(record))).toBeNull()
    expect(parseTunnelRecord(record.id, '{')).toBeNull()
  })
})
