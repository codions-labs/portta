// Strip discovered secrets out of a string before it can reach a log, an
// error, a diagnostic or an issue body. The panel holds a password for the
// duration of one request; this is what keeps it from outliving that request
// in anything we write down.

/**
 * Replace every known secret with a placeholder. Longer secrets are applied
 * first so a password that is a prefix of another cannot leave a residue.
 */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  const unique = [...new Set(secrets.filter((value): value is string => Boolean(value && value.length > 0)))]
  unique.sort((left, right) => right.length - left.length)
  let redacted = text
  for (const secret of unique) {
    redacted = redacted.split(secret).join('***')
  }
  return redacted
}

/**
 * A Portta token, wherever it appears.
 *
 * `redactSecrets` needs to be told the values. This does not: a `ptt_` token
 * has a shape, and anything that writes a line somewhere — a log, an error, a
 * task note — can strip one it was never told about. That is the case that
 * matters, because a secret nobody knew was there is the one that gets written
 * down.
 */
const TOKEN = /\bptt_[A-Za-z0-9_-]{16,}/g

export function redactTokens(text: string): string {
  return text.replace(TOKEN, 'ptt_***')
}

/** Both: the values this process knows, and any Portta token it does not. */
export function redact(text: string, secrets: Array<string | null | undefined> = []): string {
  return redactTokens(redactSecrets(text, secrets))
}
