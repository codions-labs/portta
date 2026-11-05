import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

/** A name discriminator, not an authorization token or a uniqueness guarantee. */
export function shortHash(value: string): string {
  return bytesToHex(sha256(utf8ToBytes(value))).slice(0, 8)
}

/** NUL cannot occur in a component, so field boundaries survive normalization. */
export function nameIdentity(parts: string[]): string {
  for (const part of parts) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: controls are deliberately refused in names
    if (/[\u0000-\u001f\u007f]/.test(part)) throw new Error('a name cannot contain control characters')
  }
  return parts.join('\u0000')
}
