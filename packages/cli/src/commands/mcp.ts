// `portta mcp`: the panel verbs, spoken to an agent over stdio.
//
// The tools themselves live in `portta-mcp` and are shared with the panel,
// which serves the same list over Streamable HTTP at `POST /api/mcp`
// (ADR 0054). What this command owns is the host side of the transport: where
// the panel is, which credential goes there, and `resolve_project`, the one
// tool that reads the working tree and so exists only where the tree is.
//
// **The agent never holds a GitHub credential.** It gets stdio to this process;
// this process gets a panel URL and, when the panel is authenticated, a panel
// credential. Issues are read and written by the host daemon, through the `gh`
// session or the Linear key already on the host.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Command } from 'commander'
import {
  type ApiCaller,
  type DocumentationOrigin,
  type DocumentationReader,
  type PathResolver,
  registerSharedTools,
} from 'portta-mcp'
import { describeFailure, isLoopbackUrl, type PanelAnswer, PanelClient, panelHeaders, resolvePanelUrl } from '../api.js'
import { gatewayContext } from '../context.js'
import { PreconditionError, UsageError } from '../errors.js'
import { CLI_MODULES, registerModuleTools } from '../modules/index.js'
import { CLI_VERSION } from '../version.js'
import { localDocumentationReader, remoteDocumentationReader } from './docs.js'
import { resolvePath } from './resolve.js'

function globals(command: Command) {
  return command.optsWithGlobals() as {
    json?: boolean
    yes?: boolean
    quiet?: boolean
    verbose?: boolean
    profile?: string
  }
}

export type { ApiCaller, ToolResult } from 'portta-mcp'
export { describeFailure, isLoopbackUrl, panelHeaders, resolvePanelUrl }

export function createCaller(url: string, headers: Record<string, string>, timeoutMs = 15_000): ApiCaller {
  const client = new PanelClient(url, headers, timeoutMs)
  return async (method, path, body) => {
    let answer: PanelAnswer
    try {
      answer = await client.answer(method, path, body)
    } catch (error) {
      return {
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      }
    }
    if (!answer.ok) {
      return { content: [{ type: 'text', text: describeFailure(answer.status, answer.text) }], isError: true }
    }
    return { content: [{ type: 'text', text: answer.text }] }
  }
}

export interface CliToolOptions {
  resolvePath: PathResolver
  documentation: DocumentationReader
  documentationOrigin: DocumentationOrigin
}

/**
 * Everything `portta mcp` serves: the shared tools with the host's resolver,
 * then each module's. Separate from the command so the list can be asserted
 * without a transport.
 */
export function registerCliTools(server: McpServer, call: ApiCaller, options: CliToolOptions): void {
  registerSharedTools(server, call, options)
  registerModuleTools(server, call, CLI_MODULES)
}

export interface McpOptions {
  docsSource?: string
  url?: string
  allowRemote?: boolean
  actor?: string
}

export async function mcpCommand(options: McpOptions, command: Command): Promise<void> {
  if (options.docsSource && !['local', 'panel'].includes(options.docsSource))
    throw new UsageError('--docs-source must be local or panel')
  const context = gatewayContext({ profile: globals(command).profile, required: false })
  const url = resolvePanelUrl(context.env, options, context.env.PORTTA_WEB_PORT ?? '8081')
  const actor = options.actor ?? context.env.PORTTA_MCP_ACTOR ?? 'agent'

  // stdout is the transport. Anything written there that is not a protocol
  // message corrupts the session, which is why nothing in this command prints.
  const server = new McpServer({ name: 'portta', version: CLI_VERSION })
  // The same credential resolution as every other command: `PORTTA_TOKEN`, or
  // whatever `portta auth login` saved for this panel. An agent configured once
  // keeps working after a token rotation without its config being edited.
  // Explicitly an agent: this is the surface agents drive, and what it may do
  // is the `agentPermissions` ceiling rather than whatever the operator holds.
  const headers = panelHeaders(context.env, actor, 'agent', { url })
  const call = createCaller(url, headers)
  const documentationOrigin: DocumentationOrigin = options.docsSource === 'panel' ? 'panel' : 'local'
  registerCliTools(server, call, {
    resolvePath: (path) => resolvePath(path, new PanelClient(url, headers)),
    documentation:
      documentationOrigin === 'panel'
        ? remoteDocumentationReader((path) =>
            new PanelClient(url, panelHeaders(context.env, actor, 'agent', { url })).request('GET', path),
          )
        : localDocumentationReader(),
    documentationOrigin,
  })

  try {
    await server.connect(new StdioServerTransport())
  } catch (error) {
    throw new PreconditionError(
      `the MCP transport could not start: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
