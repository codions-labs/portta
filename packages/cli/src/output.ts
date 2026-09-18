import type { Command } from 'commander'

export interface OutputOptions {
  json?: boolean
  quiet?: boolean
  verbose?: boolean
  /** The JSON schema name; defaults to the one the running command set. */
  schema?: string
}

/**
 * The versioned envelope every `--json` output wears.
 *
 * `schema` names the format, and is the command path (`envs.list`,
 * `projects.context`). `version` is an integer that moves only on an
 * incompatible change to that command's `data`: a field removed, a type
 * changed or a meaning changed. Adding an optional field is not one, and
 * leaves the version alone. A consumer that reads `schema` and `version`
 * can tell what it received and refuse what it does not understand, instead
 * of breaking on a silent change.
 *
 * Every schema starts at version 1; a bump is a line in `SCHEMA_VERSIONS`
 * beside the change that needed it, and a note in the changelog.
 */
export interface JsonEnvelope<T = unknown> {
  schema: string
  version: number
  data: T
}

const SCHEMA_VERSIONS: Record<string, number> = {}

export function schemaVersion(schema: string): number {
  return SCHEMA_VERSIONS[schema] ?? 1
}

/**
 * The schema name of a command is its path below `portta`, joined with dots
 * and using each command's canonical name, never an alias: `envs list` and
 * `env list` are both `envs.list`.
 */
export function schemaFor(command: Command): string {
  const names: string[] = []
  for (let current: Command | null = command; current?.parent; current = current.parent) names.unshift(current.name())
  return names.join('.')
}

let currentSchema: string | null = null

/** Set once per invocation, by the CLI, before the action runs. */
export function setJsonSchema(schema: string | null): void {
  currentSchema = schema
}

export class Output {
  private readonly options: OutputOptions
  constructor(options: OutputOptions = {}) {
    this.options = options
  }

  data(value: unknown): void {
    if (this.options.json) {
      const schema = this.options.schema ?? currentSchema
      if (!schema) throw new Error('JSON output without a schema: the command did not register one')
      const envelope: JsonEnvelope = { schema, version: schemaVersion(schema), data: value }
      process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`)
    } else if (typeof value === 'string') process.stdout.write(`${value}${value.endsWith('\n') ? '' : '\n'}`)
    else process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  }

  line(value = ''): void {
    if (!this.options.quiet) process.stdout.write(`${value}\n`)
  }
  /**
   * The phase a long command is entering, so nothing can begin without saying
   * so.
   *
   * Never under `--json`: a step is narration, and a machine reading stdout
   * has no use for it even on stderr.
   */
  step(value: string): void {
    if (!this.options.quiet && !this.options.json) process.stderr.write(`\n:: ${value}\n`)
  }
  progress(value: string): void {
    if (!this.options.quiet) process.stderr.write(`${value}\n`)
  }
  detail(value: string): void {
    if (this.options.verbose) process.stderr.write(`${value}\n`)
  }
  warning(value: string): void {
    process.stderr.write(`warning: ${value}\n`)
  }
  error(value: string): void {
    process.stderr.write(`error: ${value}\n`)
  }
  hint(value: string): void {
    process.stderr.write(`  -> ${value}\n`)
  }
  get json(): boolean {
    return this.options.json === true
  }
}
