import { describe, expect, it } from 'vitest'
import { changeTags, parseTagText, relativeProjectPath, tagText } from './products.js'

describe('relativeProjectPath', () => {
  it('passes a path already relative to Projects Home as it is', () => {
    expect(relativeProjectPath('tuttoria/tuttoria', '/root/projects', '/anywhere')).toBe('tuttoria/tuttoria')
  })

  it('turns the current folder and an absolute path into one relative to Projects Home', () => {
    expect(relativeProjectPath('.', '/root/projects', '/root/projects/tuttoria/tuttoria')).toBe('tuttoria/tuttoria')
    expect(relativeProjectPath('/root/projects/sudofabio/publivor/', '/root/projects/', '/tmp')).toBe(
      'sudofabio/publivor',
    )
  })

  it('refuses a folder outside Projects Home, and one that cannot be placed', () => {
    expect(() => relativeProjectPath('/srv/billing', '/root/projects', '/tmp')).toThrow(/not under Projects Home/)
    expect(() => relativeProjectPath('/root/projects', '/root/projects', '/tmp')).toThrow(/not under Projects Home/)
    expect(() => relativeProjectPath('.', null, '/tmp')).toThrow(/not known on this host/)
  })
})

describe('tags from the terminal', () => {
  const current = [
    { key: 'cliente', value: 'Acme' },
    { key: '', value: 'loja' },
  ]

  it('reads a tag the way the panel does', () => {
    expect(parseTagText('Cliente:  Acme ')).toEqual({ key: 'cliente', value: 'Acme' })
    expect(parseTagText('loja')).toEqual({ key: '', value: 'loja' })
    expect(() => parseTagText('cliente:')).toThrow(/not a tag/)
  })

  it('adds without duplicating and removes what was asked, keeping the rest', () => {
    const next = changeTags(current, ['time: web', 'loja'], ['cliente: Acme'])
    expect(next.map(tagText)).toEqual(['loja', 'time: web'])
  })

  it('refuses more than sixteen', () => {
    const many = Array.from({ length: 17 }, (_, index) => `t${index}`)
    expect(() => changeTags([], many, [])).toThrow(/at most 16/)
  })
})
