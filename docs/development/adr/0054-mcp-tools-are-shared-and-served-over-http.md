# 0054. The MCP tools are shared, and the panel serves them over HTTP

**Status:** Accepted; see [0018](0018-github-issues-through-the-gh-cli.md),
[0035](0035-authentication-lives-in-the-panel.md),
[0046](0046-official-modules-are-composed-at-build-time.md)

## Context

`portta mcp` gives a coding agent the panel's verbs as MCP tools: one tool,
one call to one API endpoint, spoken over stdio to the agent that started
the process. The tools lived in the CLI, and the CLI was the only place they
could be served from, for one reason: the panel kept the MCP SDK out of its
dependencies on purpose, because a process that may be reachable over a VPN
carries as little as it can.

That put the CLI on the agent's side of the boundary. An agent working in a
Dev Container, on a remote worktree or in a cloud runner has no `portta`
binary where it runs, no `portta auth login` state, and often no way to
reach the panel except over HTTP. It could reach the API directly, but the
API is not what an agent's harness speaks; the tools are.

Meanwhile the tools themselves never depended on the CLI. Each one is an
`ApiCaller` — a function that makes one request and words a refusal — and a
`zod` schema. The only tool that reads the host is `resolve_project`, which
needs the working tree to say which Project a directory belongs to.

## Decision

> **The tool registrations live in `portta-mcp`, a workspace both transports
> import. `portta mcp` serves them over stdio from the host. The panel serves
> the same list over Streamable HTTP at `POST /api/mcp`, off by default,
> stateless, behind the same principal as every other route and under the
> same agent ceiling. `resolve_project` stays host-only.**

- `portta-mcp` depends on the contract and the SDK, and on nothing that knows
  a process. A transport hands it an `ApiCaller`; the CLI's is an HTTP client
  with a credential, the panel's re-enters its own API as the caller that
  opened the exchange.
- A module contributes its tools to both transports through its registry
  entry ([0046](0046-official-modules-are-composed-at-build-time.md)):
  `CliModule.mcp` and `ServerModule.mcp` name the same function.
- The panel's transport is enabled by `PORTTA_MCP_HTTP=true` and is otherwise
  absent. Each POST is one JSON-RPC exchange; no session is kept, so a
  credential is checked on every request and a revoked token stops working
  on the next one. GET and DELETE answer 405.
- Every call a tool makes re-enters the API with the caller's credential, the
  actor the panel already resolved, and `X-Portta-Actor-Kind: agent`. A
  caller cannot claim to be a person through this transport: on an open panel
  that is the `agentPermissions` ceiling; on a protected one the token
  decides ([0035](0035-authentication-lives-in-the-panel.md)).
- `resolve_project` is served only where the working tree is. The two lists
  are asserted equal minus that one tool, so they cannot drift apart.

## Consequences

- **The SDK is a panel dependency.** That restraint is spent on purpose,
  once, for a surface that is off unless the operator turns it on.
- **Tools are registered once.** A verb added to `portta-mcp` reaches both
  transports; a tool that exists on one and not the other is a test failure.
- **Exposure follows the panel's.** The endpoint is wherever the panel is:
  loopback, a tailnet, a VPN or a public hostname, as `PORTTA_WEB_EXPOSE`
  decides. Turning it on is a decision about who may reach the panel, and
  the documentation says so plainly rather than treating it as a second,
  separately guarded door.
- **The CLI keeps the host.** `portta mcp` remains the transport for an
  agent that runs beside the working tree, and the one that can say which
  Project a path belongs to.
