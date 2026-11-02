# 0055. Portta routes and protects; agents do the work

**Status:** Accepted

## Context

An earlier shape of the project tried to be the place where AI work happens:
managed worktrees, sessions and runs, a daemon on the host, an MCP server and an
issue tracker integration. That made Portta responsible for things its users
already have better tools for (Claude Code, Codex, OpenCode, Pi, herdr, Orca,
`gh`), and for the cost, credentials and failure modes of running models.

## Decision

Portta decides **where a project runs and how it is reached**: a hostname per
service, no published ports, private databases, a decision per site about who
may open it, and an environment per branch or worktree. It does not run AI, hold
a model credential, track issues or manage git.

Agents learn the host through three layers, none of which executes a model: a
global instruction block, a session hook that prints `portta agent context`, and
skills loaded on demand. The CLI is the only interface an agent needs, so there
is no MCP server and no host daemon.

## Consequences

**The product is smaller and has no model cost.** There is no provider key to
leak, no session state to store and no process to supervise on the host.

**Agents of any brand work the same way.** What changes between them is only
where the instruction block, the hook and the skills are written, which
`portta agents install` does.

**Some convenience is gone on purpose.** Starting an agent from the panel,
issue lists and run histories are the job of the tools around Portta.
