import { describe, expect, it } from 'vitest'
import {
  httpAccessOperationPath,
  httpAccessOverlayPath,
  parseHttpAccessStore,
  readHttpAccessStore,
} from './http-access.ts'

describe('HTTP attachment intent', () => {
  it('reads an absent store as no attachments and validates identities before using paths', () => {
    expect(readHttpAccessStore('/does-not-exist/portta-http-access.json')).toEqual({ version: 1, attachments: [] })
    expect(parseHttpAccessStore('{"version":1,"attachments":[{"project":"shop","service":"mailpit"}]}')).toEqual({
      version: 1,
      attachments: [{ project: 'shop', service: 'mailpit' }],
    })
    expect(() => parseHttpAccessStore('{"version":2,"attachments":[]}')).toThrow('invalid HTTP access store')
    expect(() =>
      parseHttpAccessStore('{"version":1,"attachments":[{"project":"../shop","service":"mailpit"}]}'),
    ).toThrow('identity')
    expect(() => httpAccessOverlayPath('/portta', '../shop')).toThrow('project')
    expect(() => httpAccessOperationPath('/portta', '../request')).toThrow('request id')
  })

  it('refuses duplicate attachments instead of projecting conflicting service entries', () => {
    const attachment = { project: 'shop', service: 'mailpit' }
    expect(() => parseHttpAccessStore(JSON.stringify({ version: 1, attachments: [attachment, attachment] }))).toThrow(
      'duplicate',
    )
  })
})
