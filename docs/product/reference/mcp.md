# MCP reference

`portta mcp` is a [Model Context Protocol](https://modelcontextprotocol.io)
server. It speaks stdio to an agent. Operational tools call the panel API; documentation tools read the bundled corpus unless a panel source is explicitly selected.
The panel can serve the same tools itself, over HTTP, for an agent that has no
CLI where it runs ([Reach it over HTTP](#reach-it-over-http)).

The point of it is what the agent *does not* get: **no forge credential and no
Docker socket**. Issues are read and written by the host daemon, with the
operator's own `gh` session for GitHub and `LINEAR_API_KEY` for Linear
([ADR 0018](../../development/adr/0018-github-issues-through-the-gh-cli.md)).
The container lifecycle stays behind the panel's allowlist, and the agent holds
stdio to a process that knows a panel URL.

```text
Agent  ──stdio──>  portta mcp  ──HTTP──>  Portta panel
                                              ▲   │
Agent  ──HTTP (POST /api/mcp)─────────────────┘   │
                                        Projects, sessions, activity
                                        Docker · Git scan · metrics
                                              │
                                        host daemon ── gh / Linear
```

## Configure it

Operational tools need a running panel (`portta web up`). Issue tools also need
the host daemon (`portta host serve`) with `gh` signed in or `LINEAR_API_KEY`
set on the host. Documentation tools work locally without a running panel.

```jsonc
{
  "mcpServers": {
    "portta": {
      "command": "portta",
      "args": ["mcp", "--actor", "claude-code"],
      "env": {
        // Only when the panel is authenticated. Omitted for a loopback panel
        // with no credential, which is the default.
        "PORTTA_TOKEN": "ptt_…"
      }
    }
  }
}
```

For Claude Code, the same thing in one command:

```bash
claude mcp add portta -- portta mcp --actor claude-code
```

| Flag / variable | What it does |
|---|---|
| `--url <url>`, `PORTTA_URL` | The panel API base. Defaults to `http://127.0.0.1:<PORTTA_WEB_PORT>` |
| `--allow-remote` | Permit a non-loopback panel URL. **Required** for one: that URL is where the panel credential would be sent |
| `--actor <name>`, `PORTTA_MCP_ACTOR` | Sent on every call as `X-Portta-Actor`. Recorded on sessions and activity; never forwarded anywhere else |
| `PORTTA_TOKEN` | The Bearer credential a protected panel needs. The token names its owner, and what it holds is the intersection of its scopes and their role. Without it, whatever `portta auth login` saved for this panel is used |

`portta mcp` refuses a non-loopback panel URL unless you pass `--allow-remote`,
because that URL is where a credential goes.

## Reach it over HTTP

The panel can serve the same tools itself, as a
[Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#streamable-http)
MCP server at `POST <panel>/api/mcp`. It is for an agent that has no `portta`
binary where it runs — a Dev Container, a remote worktree, a cloud runner —
and can reach the panel over the network. Nothing about the tools changes:
each one is still one call to one endpoint, worded the same way when it fails.

It is off by default. Turn it on in `.env` and apply:

```bash
PORTTA_MCP_HTTP=true
portta up
```

The endpoint is stateless: every POST is one JSON-RPC exchange, no session is
kept, and `GET` or `DELETE` answer `405`. Authenticate with a
[personal API token](../guides/authentication.md#tokens-for-the-cli-and-agents)
as a Bearer header. A client configuration:

```jsonc
{
  "mcpServers": {
    "portta": {
      "url": "http://portta.localhost/api/mcp",
      "headers": {
        "Authorization": "Bearer ptt_…",
        // Attribution, as with --actor. Recorded on sessions and activity.
        "X-Portta-Actor": "claude-code"
      }
    }
  }
}
```

What differs from stdio:

- **`resolve_project` is stdio-only.** It reads the working tree on the host
  to say which Project a directory belongs to, and the panel has no working
  tree. Every other tool is served, including each module's.
- **The same ceiling applies.** Every call is an agent's, whatever the request
  declared: on a panel with authentication disabled that is the
  `agentPermissions` setting; on a protected panel it is what the token holds.
  A missing or revoked token is refused before any tool runs, and a permission
  the token lacks comes back as the tool's own error, with the permission
  named.
- **The endpoint follows the panel's exposure.** It answers wherever the
  panel answers — loopback, a tailnet, a VPN or a public hostname, exactly as
  `PORTTA_WEB_EXPOSE` decides. Exposing the panel exposes it. On anything but
  loopback, run the panel with `PORTTA_AUTH_MODE=required` and hand each agent
  its own token, so that revoking one stops one agent.

See [ADR 0054](../../development/adr/0054-mcp-tools-are-shared-and-served-over-http.md)
for why the tools are one list served by two transports.

## What the actor means

`X-Portta-Actor` is self-declared. It does not authenticate anything — a token
or a session does that — it says *which* caller this is. Two things follow:

- every session and activity event carries the name, so a person reading the
  panel from elsewhere can tell what an agent did;
- on a panel with `PORTTA_AUTH_MODE=disabled`, an agent that announces itself
  holds the `agentPermissions` setting rather than everything. By default that
  is a developer minus the two things that change how the panel behaves:
  `environment:settings` and `repository:manage`. A refused call
  answers `403` with the permission named. On a protected panel the token
  decides instead, and the header is attribution alone. See
  [ADR 0032](../../development/adr/0032-portta-development-model.md) and
  [ADR 0035](../../development/adr/0035-authentication-lives-in-the-panel.md).

## The tools

Reads, all local to the panel:

| Tool | Reaches |
|---|---|
| `resolve_project` | the CLI's resolver: which Project an absolute path on this host belongs to (root, subdirectory, worktree, or inferred from the remote), or why it cannot say (`unknown`, `ambiguous`, `stale`, `unauthorized`); the same answer as `portta projects resolve --path` |
| `list_projects` | `GET /api/projects` |
| `get_project` | `GET /api/projects/:slug` |
| `get_context` | `GET /api/projects/:slug/context` — the Development Context, below |
| `list_repositories` | `GET /api/projects/:slug/repositories` |
| `get_repository_git` | `GET /api/repositories/:id/git` — branch, HEAD, dirty counts, recent commits, instruction files |
| `list_specifications` | `GET /api/repositories/:id/specifications` — the decision records (`docs/**/adr/*.md`) and OpenSpec or Spec Kit documents the scan recognised, as references: path, convention, kind, title, hash, dirty. Never content |
| `list_environments` | `GET /api/environments` |
| `get_environment` | `GET /api/environments/:name` |
| `list_services` | `GET /api/environments/:name/services` — one row per service with its access, resources and actions |
| `get_logs` | `GET /api/environments/:name/logs` |
| `get_resources` | `GET /api/metrics/current` |
| `list_activity` | `GET /api/activity`, or `GET /api/projects/:slug/activity` with `project` |

`get_resources` reaches `GET /api/projects/:slug/resources` when it is given a
`project`.

Issues, read and written live in GitHub or Linear through the host daemon.
Every issue tool takes the Project slug, which decides the repository or Linear
team; no tool takes a repository:

| Tool | Reaches | Input |
|---|---|---|
| `list_issues` | `GET /api/projects/:slug/issues` | `project`; optional `state` (`open`, `closed`, `all`; default `open`), `assignee` and `q` (GitHub only), `label` |
| `get_issue` | `GET /api/projects/:slug/issues/:key` | `project`, `issue`. Body, comments, labels, assignees and the environments running for it |
| `create_issue` | `POST /api/projects/:slug/issues` | `project`, `title`; optional `body` (Markdown), `labels`, `assignees` |
| `update_issue` | `PATCH /api/projects/:slug/issues/:key` | `project`, `issue`; optional `title`, `body`, `state` (`open`, `closed`), `stateReason` (`completed`, `not planned`), `addLabels`, `removeLabels`, `addAssignees`, `removeAssignees` |
| `comment_on_issue` | `POST /api/projects/:slug/issues/:key/comments` | `project`, `issue`, `body` (Markdown) |

Writes run as whoever is signed in on the host. Labels and assignees are added
and removed, never replaced, so two writers merge.

Sessions:

| Tool | Reaches |
|---|---|
| `start_session` | `POST /api/projects/:slug/sessions` — `project`; optional `issueRef`, `repositoryId`, `environment`, `summary` |
| `end_session` | `PATCH /api/sessions/:id` — `session`; optional `summary` |

Operation, each gated by the permission its route declares:

| Tool | Reaches |
|---|---|
| `start_environment` | `POST /api/environments/:name/actions/start` |
| `stop_environment` | `POST /api/environments/:name/actions/stop` |
| `restart_service` | `POST /api/environments/:name/services/:service/actions/restart` |

One tool, one endpoint. No tool composes two calls: a workflow that needs
composing composes in the API, where it can be tested without a transport.

An issue is addressed by the reference Portta names it by:
`github:owner/repo#113`, `linear:ENG-42`. It is the provider's own coordinate,
already in the branch name, the commit message and the URL. The tools also
accept the bare key (`113`, `ENG-42`), because the Project already names the
provider.

The [Taskflow module](../../modules/taskflow/README.md) adds sixteen tools of
its own: `list_flow_projects`, `list_worktrees`,
`create_worktree`, `remove_worktree`, `send_to_worktree`, `list_workflows`,
`run_workflow`, `start_direct_session`, `list_runs`, `get_run`, `cancel_run`,
`resume_run`, `respond_permission`, `get_transcript`,
`list_environment_services` and `expose_endpoint`. Each is described in
[Taskflow integrations](../../modules/taskflow/integrations.md).

### The Development Context

`get_context` is what an agent reads before it works. One answer carries:

- `schema` and `version`: the answer is `development-context`, version `1`.
  The version moves only on an incompatible change to the shape, so a consumer
  reads the two first and refuses what it does not know;
- the Project: name, description, path;
- its repositories, each with git state (branch, `ahead`/`behind` and the
  `base` they are measured against), the git root on the host, the
  environments it runs from, the **worktrees** the Taskflow daemon knows for
  it (path, branch, base, and the adopted Environment that runs one), and the
  **instruction files** the host collected (`AGENTS.md`, `CLAUDE.md`,
  `.cursor/rules/*.mdc`, …) with their content, and the **specification
  references** it recognised — decision records, OpenSpec and Spec Kit
  documents — by path, kind, title and hash, never by content;
- the environments it adopted, with their services, primary addresses and
  the commands that start, stop and read their logs;
- the issue, in full, when the call named one with `issue`;
- the effective instructions — the rules of a shared development host, the
  project's note, every repository's files, and the body and comments of the
  issue that was named — in the order an agent should read them;
- the CLI verbs that matter here, ready to copy;
- `diagnostics`: what is observed and wrong, each with the command that fixes
  it — a repository without a path, a scan missing or stale, an adopted
  Environment that is stopped, a Taskflow daemon that did not answer (the
  worktrees are then unknown, not absent). An empty list means nothing needs
  doing first.

### What a write does

An agent says it is working (`start_session`), says it is done
(`end_session`), operates environments and services, and changes issues with
the issue tools. An issue write goes straight to GitHub or Linear; Portta keeps
no copy of the issue, only its reference and the environments that run for it
([Work with issues](../guides/issues.md)). Issue writes need `issue:write`.

## What an agent cannot do through this

- **Reach an issue outside its Project.** Issue tools take a Project, never a
  repository, so an agent cannot write to a repository nobody linked.
- **Destroy anything**, by default: removing an environment or a container
  needs `environment:destroy` or `container:destroy`, which an agent's token
  does not hold unless somebody put it there.
- **Reach a Project it cannot see**, which is also what bounds which
  repositories and issues it can reach at all.
- **Hold a forge credential, or the Docker socket.**

## When something fails

The tools carry the panel's answer through as words, because an agent needs to
tell "you asked for something impossible" from "try again later":

| The panel said | The tool says |
|---|---|
| 400 | `refused: …` — the request will never succeed as written |
| 401, 403 | `not permitted: …` — no credential, read-only mode, a permission the caller does not hold, a Project they do not reach, or a provider that refused the host's credential |
| 404 | `not found: …` |
| 503 | `temporarily unavailable, and worth retrying: …` — the host daemon or the provider could not be reached |
| any other status | `the panel answered <status>: …` — for example `429` when the provider's rate limit is exhausted, or `502`/`504` when the provider failed or timed out |
| nothing | the panel URL, and why the connection failed |

Read-only mode (`portta web up --read-only`) refuses every write verb and
leaves every read working, which makes it a reasonable way to give an agent a
look and nothing more.

## Related

- [CLI contract](cli.md) — the same verbs, for a terminal
- [Connect GitHub](../guides/github.md) — `gh` on the host, and what it can reach
- [Work with issues](../guides/issues.md) — where a Project's work actually lives
- [Use the web panel](../guides/web-ui.md) — the same work, for a person
- [ADR 0032](../../development/adr/0032-portta-development-model.md) — the model this serves

## Documentation tools

| Tool | Input | Result |
| --- | --- | --- |
| `list_docs` | Optional `audience`: `user`, `developer`, `all` | Page metadata and navigation |
| `search_docs` | `q`, optional `audience` and `limit` (1–50) | Ranked excerpts with document and heading URLs |
| `get_doc` | `slug`, optional `anchor` | Canonical Markdown or a heading subtree |

All three tools are read-only. They return structured content and a textual representation with the origin, version and content hash. Internal instructions and research are excluded.

The default source is the local CLI corpus. Operational tools may still use the panel while documentation remains local. To select that panel's documentation explicitly:

```bash
portta mcp --docs-source panel --url http://127.0.0.1:8081
```

Remote access uses the existing `--allow-remote` and authentication contract. An unavailable remote corpus returns an error instead of substituting the local version. No tool fetches documentation from GitHub automatically.
