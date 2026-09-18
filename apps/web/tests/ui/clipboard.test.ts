import { afterEach, expect, it, vi } from 'vitest'
import { copyText } from '@/lib/clipboard'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('falls back after a clipboard denial and restores keyboard focus', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  const button = document.createElement('button')
  document.body.appendChild(button)
  button.focus()
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn(() => {
      expect(document.querySelector('textarea')?.value).toBe('portta doctor')
      return true
    }),
  })
  await copyText('portta doctor')
  expect(document.activeElement).toBe(button)
  expect(document.querySelector('textarea')).toBeNull()
})

it('reports a failed fallback without leaving temporary controls behind', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
  await expect(copyText('portta doctor')).rejects.toThrow('Clipboard is unavailable')
  expect(document.querySelector('textarea')).toBeNull()
})
