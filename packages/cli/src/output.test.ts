import { Command } from 'commander'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Output, schemaFor, setJsonSchema } from './output.js'

describe('output', () => {
  afterEach(() => {
    setJsonSchema('test')
    vi.restoreAllMocks()
  })

  it('wraps JSON in the versioned envelope and keeps progress on stderr', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const output = new Output({ json: true, schema: 'envs.list' })
    output.progress('working')
    output.data({ ok: true })
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
      schema: 'envs.list',
      version: 1,
      data: { ok: true },
    })
    expect(stderr).toHaveBeenCalledWith('working\n')
  })

  it('uses the schema the running command registered', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    setJsonSchema('projects.context')
    new Output({ json: true }).data({ project: 'shop' })
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toMatchObject({ schema: 'projects.context', version: 1 })
  })

  it('refuses to emit JSON that no command claimed', () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    setJsonSchema(null)
    expect(() => new Output({ json: true }).data({ ok: true })).toThrow(/without a schema/)
  })

  it('leaves the human output alone', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    new Output({}).data({ ok: true })
    new Output({}).data('done')
    expect(stdout).toHaveBeenNthCalledWith(1, '{\n  "ok": true\n}\n')
    expect(stdout).toHaveBeenNthCalledWith(2, 'done\n')
  })

  it('names a schema after the command path, never an alias', () => {
    const program = new Command('portta')
    const envs = program.command('envs').alias('env')
    const list = envs.command('list')
    const status = program.command('status')
    expect(schemaFor(list)).toBe('envs.list')
    expect(schemaFor(status)).toBe('status')
    // Every action command in a tree resolves to a distinct, non-empty name.
    const leaves = (command: Command): Command[] =>
      command.commands.length ? command.commands.flatMap(leaves) : [command]
    const schemas = leaves(program).map(schemaFor)
    expect(new Set(schemas).size).toBe(schemas.length)
    expect(schemas.every((schema) => schema.length > 0)).toBe(true)
  })
})
