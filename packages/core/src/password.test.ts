import { describe, expect, it } from 'vitest'
import { generatePassword, hashPassword, verifyPassword } from './password.ts'

describe('generatePassword', () => {
  it('is 20 unambiguous characters, grouped for transcription', () => {
    const password = generatePassword()
    expect(password.replace(/-/g, '')).toHaveLength(20)
    expect(password).toMatch(/^[23456789A-HJ-NP-Z]{5}(-[23456789A-HJ-NP-Z]{5}){3}$/)
  })
})

describe('password verification', () => {
  it('writes and verifies the bounded Portta scrypt format', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).toMatch(/^\$portta\$scrypt\$65536\$8\$1\$/)
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true)
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false)
  })

  it('refuses malformed and foreign formats without throwing', async () => {
    await expect(verifyPassword('secret', '$portta$scrypt$999999999$8$1$bad$bad')).resolves.toBe(false)
    await expect(verifyPassword('secret', '$foreign$hash')).resolves.toBe(false)
    await expect(verifyPassword('secret', 'secret')).resolves.toBe(false)
  })
})
