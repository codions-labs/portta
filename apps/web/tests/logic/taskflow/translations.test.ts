import { describe, expect, it } from 'vitest'
import { taskflowWebModule } from '@/modules/taskflow'

function keysOf(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) => keysOf(child, prefix ? `${prefix}.${key}` : key))
}

function leavesOf(value: unknown): unknown[] {
  if (typeof value !== 'object' || value === null) return [value]
  return Object.values(value).flatMap(leavesOf)
}

describe('Taskflow translations', () => {
  const { en, 'pt-BR': pt } = taskflowWebModule.messages

  it('ship every English key in Brazilian Portuguese, and no empty string', () => {
    for (const namespace of Object.keys(en) as Array<keyof typeof en>) {
      expect(keysOf(pt[namespace]).sort(), namespace).toEqual(keysOf(en[namespace]).sort())
      expect(
        leavesOf(pt[namespace]).filter((leaf) => typeof leaf !== 'string' || leaf.trim() === ''),
        namespace,
      ).toEqual([])
    }
  })
})
