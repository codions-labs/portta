import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..', 'messages')

function leaves(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix]
  return Object.entries(value).flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key))
}

describe('message catalogs', () => {
  it('ship the same namespaces in every locale', () => {
    expect(readdirSync(join(root, 'pt-BR')).sort()).toEqual(readdirSync(join(root, 'en')).sort())
  })

  for (const file of readdirSync(join(root, 'en'))) {
    it(`${file} has the same keys in en and pt-BR`, () => {
      const read = (locale: string) => leaves(JSON.parse(readFileSync(join(root, locale, file), 'utf8'))).sort()
      expect(read('pt-BR')).toEqual(read('en'))
    })
  }
})
