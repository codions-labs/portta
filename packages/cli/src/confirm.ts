import { stderr, stdin } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { RefusedError } from './errors.js'

export async function confirm(message: string, yes: boolean): Promise<void> {
  if (yes) return
  if (!stdin.isTTY)
    throw new RefusedError(
      `${message}; confirmation is unavailable without a TTY`,
      'pass --yes to confirm non-interactively',
    )
  const prompt = createInterface({ input: stdin, output: stderr })
  try {
    const answer = await prompt.question(`${message} [y/N] `)
    if (!/^y(es)?$/i.test(answer.trim())) throw new RefusedError('operation cancelled')
  } finally {
    prompt.close()
  }
}
