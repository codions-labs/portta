// portta-mcp: the MCP tools, registered once and served by two transports.
//
// `portta mcp` serves them over stdio from the host, where it can also resolve
// a directory to its Project. The panel serves the same tools over Streamable
// HTTP at `POST /api/mcp`, for an agent that has no CLI where it runs. Both
// hand in an `ApiCaller`; nothing here knows which transport it is on.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  DOC_TOOL_NAMES,
  type DocumentationOrigin,
  type DocumentationReader,
  registerDocumentationTools,
} from './docs-tools.ts'
import {
  type ApiCaller,
  HOST_ONLY_TOOL_NAMES,
  PANEL_TOOL_NAMES,
  type PathResolver,
  registerPanelTools,
} from './tools.ts'

export {
  DOC_TOOL_NAMES,
  type DocumentationOperation,
  type DocumentationOrigin,
  type DocumentationReader,
  registerDocumentationTools,
  remoteDocumentationReader,
} from './docs-tools.ts'
export { registerTaskflowTools, TASKFLOW_TOOL_NAMES } from './taskflow-tools.ts'
export {
  type ApiCaller,
  asSdkResult,
  describeFailure,
  HOST_ONLY_TOOL_NAMES,
  type HttpMethod,
  PANEL_TOOL_NAMES,
  type PathResolver,
  registerPanelTools,
  type ToolResult,
} from './tools.ts'

export interface SharedToolOptions {
  /** Present only on the host. Without it `resolve_project` is not registered. */
  resolvePath?: PathResolver
  documentation: DocumentationReader
  documentationOrigin: DocumentationOrigin
}

/**
 * The tools both transports serve: the panel's verbs and the documentation.
 * A module's tools are registered by each side's module registry, after these.
 */
export function registerSharedTools(server: McpServer, call: ApiCaller, options: SharedToolOptions): void {
  registerPanelTools(server, call, options.resolvePath)
  registerDocumentationTools(server, options.documentation, options.documentationOrigin)
}

/** Exactly what `registerSharedTools` registers on a transport with, or without, the host. */
export function sharedToolNames(options: { host: boolean }): string[] {
  const hostOnly: readonly string[] = HOST_ONLY_TOOL_NAMES
  const panel = options.host ? [...PANEL_TOOL_NAMES] : PANEL_TOOL_NAMES.filter((name) => !hostOnly.includes(name))
  return [...panel, ...DOC_TOOL_NAMES]
}
