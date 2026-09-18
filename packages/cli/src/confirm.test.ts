import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  question: vi.fn<() => Promise<string>>(),
  close: vi.fn(),
}))

vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: mocks.question, close: mocks.close }),
}))

import { confirm } from './confirm.ts'

const originalIsTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

function setTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value })
}

describe('confirmation contract', () => {
  beforeEach(() => {
    mocks.question.mockReset()
    mocks.close.mockReset()
  })

  afterEach(() => {
    if (originalIsTty) Object.defineProperty(process.stdin, 'isTTY', originalIsTty)
    else Reflect.deleteProperty(process.stdin, 'isTTY')
  })

  it('refuses a required prompt without a TTY using exit code 4', async () => {
    setTty(false)
    await expect(confirm('Remove it?', false)).rejects.toMatchObject({
      exitCode: 4,
      hint: 'pass --yes to confirm non-interactively',
    })
    expect(mocks.question).not.toHaveBeenCalled()
  })

  it('lets --yes confirm non-interactively without opening a prompt', async () => {
    setTty(false)
    await expect(confirm('Remove it?', true)).resolves.toBeUndefined()
    expect(mocks.question).not.toHaveBeenCalled()
  })

  it('keeps an empty interactive answer defaulting to No', async () => {
    setTty(true)
    mocks.question.mockResolvedValue('')
    await expect(confirm('Remove it?', false)).rejects.toMatchObject({ exitCode: 4 })
    expect(mocks.question).toHaveBeenCalledWith('Remove it? [y/N] ')
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})
