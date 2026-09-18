function stripAnsi(input: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the control byte that begins an ANSI escape sequence.
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1B[@-_]/g, '')
}

export function normalizeTextForPrompt(input: string, maxChars = 30000): string {
  const noAnsi = stripAnsi(input).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Keep tabs, newlines, and printable ASCII only to avoid terminal control issues.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: These explicit byte ranges retain tabs, newlines, and printable ASCII.
  const cleaned = noAnsi.replace(/[^\x09\x0A\x20-\x7E]/g, '')
  if (cleaned.length > maxChars) {
    return `[... truncated]\n${cleaned.slice(-maxChars)}`
  }
  return cleaned
}
