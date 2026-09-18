import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Command } from 'commander'
import { defineModule } from 'portta-core/modules'
import { describe, expect, it } from 'vitest'
import type { GatewayContext } from '../context.js'
import {
  CLI_MODULES,
  type CliModule,
  moduleDoctorChecks,
  moduleEnvironment,
  registerModuleCommands,
  registerModuleTools,
} from './index.js'

const fake: CliModule = {
  manifest: defineModule({ id: 'fake', name: 'Fake', permissions: {}, activityKinds: [] }),
  register: (program) => {
    program.command('fake').description('A module command')
  },
  mcp: (server, call) => {
    server.registerTool(
      'list_widgets',
      { title: 'Widgets', inputSchema: {} },
      async () => call('GET', '/modules/fake/widgets') as never,
    )
  },
  doctor: async () => [{ id: 'fake', status: 'pass', title: 'fake', detail: 'ok', fix: '' }],
}

describe('CLI modules', () => {
  it('register nothing from an empty registry', () => {
    const program = new Command()
    registerModuleCommands(program, { env: {} }, [])
    expect(program.commands).toEqual([])
  })

  it('mount Taskflow as `portta flow`', () => {
    expect(CLI_MODULES.map((module) => module.manifest.id)).toEqual(['taskflow'])
    const program = new Command('portta')
    registerModuleCommands(program, { env: {} }, CLI_MODULES)
    const flow = program.commands.find((command) => command.name() === 'flow')
    let help = ''
    flow?.configureOutput({ writeOut: (text) => (help += text) }).outputHelp()
    expect(help).toContain('Usage: portta flow [options] [command]')
    expect(help).toContain('portta host serve')
    expect(flow?.commands.map((command) => command.name())).not.toContain('serve')
  })

  it('add their commands, tools and checks', async () => {
    const modules = [fake]
    const program = new Command()
    registerModuleCommands(program, { env: {} }, modules)
    expect(program.commands.map((command) => command.name())).toEqual(['fake'])

    const server = new McpServer({ name: 'test', version: '0' })
    const calls: string[] = []
    registerModuleTools(
      server,
      async (method, path) => {
        calls.push(`${method} ${path}`)
        return { content: [] }
      },
      modules,
    )
    const tools = (
      server as unknown as { _registeredTools: Record<string, { handler: (args: unknown) => Promise<unknown> }> }
    )._registeredTools
    await tools.list_widgets?.handler({})
    expect(calls).toEqual(['GET /modules/fake/widgets'])

    expect(await moduleDoctorChecks({} as GatewayContext, modules)).toHaveLength(1)
  })

  it('read their settings from the installation .env over the inherited environment', () => {
    const root = mkdtempSync(join(tmpdir(), 'portta-modules-'))
    writeFileSync(join(root, '.env'), 'PORTTA_HOST_PORT=5999\n')
    expect(moduleEnvironment(root).PORTTA_HOST_PORT).toBe('5999')
    expect(moduleEnvironment(join(root, 'missing')).PORTTA_HOST_PORT).toBe(process.env.PORTTA_HOST_PORT)
  })
})
