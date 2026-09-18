export const EXIT = {
  success: 0,
  failure: 1,
  usage: 2,
  precondition: 3,
  refused: 4,
} as const

export class CliError extends Error {
  readonly exitCode: number
  readonly hint: string | undefined
  constructor(message: string, exitCode: number = EXIT.failure, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
    this.hint = hint
  }
}

export class PreconditionError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT.precondition, hint)
  }
}

export class RefusedError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT.refused, hint)
  }
}

export class UsageError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, EXIT.usage, hint)
  }
}
