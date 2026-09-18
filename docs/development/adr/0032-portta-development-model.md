# 0032. The Portta development model

**Status:** Accepted; see [0010](0010-git-collected-on-the-host.md), [0013](0013-what-the-panel-persists.md), [0031](0031-projects-home-and-project.md), [0038](0038-roles-and-project-access.md), [0050](0050-work-lives-in-an-external-provider.md)

## Context

[ADR 0031](0031-projects-home-and-project.md) settles the words: a Project
is what is being developed, a Repository is its Git, an Environment is one
execution of it on this Node. It does not say what a Project *contains*
beyond repositories and environments, or what the panel remembers about the
work done in it.

Three questions have to have answers the panel can give from another machine:
which repositories a Project owns, with or without a forge; who is working on
what, since when, and against which environment; and what happened — a write
that matters, with an actor, kept long enough to answer "what happened this
week".

The centre of the experience has to be the Project and its development
cycle — demand, code, execution, test, analysis, correction, completion — for
a person and for an agent, through the UI, the API and the CLI alike.
Infrastructure stays; it is organised around that.

## Decision

> **Portta organises technology around the work of development, not the
> work of development around the infrastructure.**

### The model

```text
Node (Projects Home)
└── Project ──────────────── Issue ref (github:owner/repo#n, linear:ENG-42) → external provider
    ├── Repositories ─────── Git · recent commits · instruction files · pull requests
    ├── Environments ─────── Services ── Containers · endpoints · logs · resources
    ├── Work Sessions (actor × issue ref × repository × environment)
    ├── Activity (what happened, with references to all of the above)
    └── Effective instructions = Platform + Project + Repository
```

Invariants the code must keep:

1. **Everything above exists without a forge**, except the issue itself.
   Repositories, environments, sessions, activity, resources, the Development
   Context and the effective instruction files are local; an issue is read
   from its provider when a caller asks for one
   ([ADR 0050](0050-work-lives-in-an-external-provider.md)).
2. **Project and Repository are decisions.** They are persisted.
   Environment, Service, Container, Git state and resources are observations:
   read from Docker and from files the host wrote, with their age on screen.
   An issue is neither, because Portta does not store it
   ([ADR 0013](0013-what-the-panel-persists.md)).
3. **A work session belongs to one Project**, and optionally to a Repository
   and an Environment; what it names is an issue ref. An environment is linked
   to at most one issue, through `environment_issues`.
4. **A Repository belongs to exactly one Project.** A repository in several
   Projects would make Activity and resource attribution ambiguous.
5. **Every write that matters is an activity event with an actor.**

### Persistence

Tables: `projects`, `repositories`, `environments`, `work_sessions`,
`activity_events`, `environment_issues`, beside the settings tables and the
identity tables [ADR 0035](0035-authentication-lives-in-the-panel.md) owns.
Issue state is the provider's: GitHub's `open`/`closed`, and for Linear the
same two, projected from its workflow-state types with the state's own name
kept beside them.

### What the host collects

[ADR 0010](0010-git-collected-on-the-host.md) collects metadata and never a
diff, an arbitrary file or a `.env`. Two things are collected on top, narrowly:

- **The last twenty commits, as metadata** (sha, subject, author, date).
  Reviewing what an agent produced without a terminal is the point of the
  work surface; a link to the forge does not work for a repository that has no
  forge.
- **The content of the instruction files an agent reads** — `AGENTS.md`,
  `CLAUDE.md`, `GEMINI.md`, `CONVENTIONS.md`, `.clinerules`, `.cursorrules`,
  `.windsurfrules`, `.github/copilot-instructions.md`, `.cursor/rules/*.mdc`
  — from that allowlist and nowhere else, bounded at 64 KiB per file, with
  a hash and a dirty flag. `packages/core/src/repos-scan.ts` is the allowlist;
  a test asserts a `.env` next to an `AGENTS.md` stays out.
- **References to the specification documents a project keeps** — decision
  records under `docs/**/adr/` and equivalents, an `openspec/` tree, a Spec
  Kit tree — as path, convention, kind, title, hash and dirty flag. The title
  line is the only content read; the documents themselves are never copied
  ([ADR 0053](0053-portta-is-spec-aware-not-spec-owned.md)). The same
  allowlist-and-provenance scan, bounded to named directories at a fixed
  depth, and the same test discipline.

Collection is keyed by repository (the realpath of the git root), not by
Compose project, and an index maps each environment to the repository it
runs from. The metrics watcher runs the scan once a minute, so freshness does
not depend on somebody running `portta up`. The panel mounts no project
directory and runs no command.

### One API, three clients

The UI, the CLI and an agent (through `portta mcp`) use the same endpoints:
`/api/projects`, `/api/repositories`, `/api/environments`, `/api/sessions`,
`/api/activity`, `/api/overview`, `/api/projects/:slug/issues` and
`/api/projects/:slug/context` — the Development Context an agent reads
before it starts. Every route declares a permission from
`packages/auth/src/access-control.ts`, published in the OpenAPI document as
`x-portta-permission` ([ADR 0038](0038-roles-and-project-access.md)). A
request carries a principal: a signed-in user with a role, read-only mode
(every `*:read`), or an agent that announced itself with `X-Portta-Actor`,
which narrows the principal to the `agentPermissions` setting
(`AGENT_DEFAULT_PERMISSIONS`: a developer minus `environment:settings` and
`repository:manage`). Personal API tokens carry a subset of their owner's
permissions ([ADR 0039](0039-personal-api-tokens.md)).

## Consequences

A Project with no forge reachable has repositories, environments, sessions, an
activity timeline, a Development Context and a working MCP. Its issues need
the provider ([ADR 0050](0050-work-lives-in-an-external-provider.md)), and
`portta projects context <slug> --issue <ref>` is how one issue is read in
full, on request.

The panel is an inventory of what is being worked on, by whom, and of the
instructions agents follow. ADR 0012's ordering — authentication before any
of this — holds, and the collected instruction files are one more reason the
collected directory is `0700`/`0600`.

Two tables persist decisions (`projects`, `repositories`) and two persist a
bounded history (`work_sessions`, `activity_events`). Activity answers "what
happened this week", not audit; audit is its own table.

What this record deliberately does not build: a file browser beyond
instruction files, a local issue tracker, GitHub Projects v2 or multiple
hosts. The model above is what makes each of them an addition rather than a
rewrite.
