# 0050. Work lives in an external provider, and Portta points at it

**Status:** Accepted; implemented for GitHub by
[0018](0018-github-issues-through-the-gh-cli.md); see [0032](0032-portta-development-model.md)

## Context

A Project's development cycle starts from demand: an issue somebody wants
done. The panel has to show it, link environments and sessions to it, and let
a person or an agent act on it. Where that issue lives is the decision.

A local tracker with a forge binding was considered and rejected: a local row
as the canonical issue, a binding to GitHub that pushes a local write and
pulls a remote change, a board with ranks, local comments, subtasks, types,
priorities, due dates and attachments. Every team using Portta already has an
issue tracker, and it is the one their pull requests, their notifications,
their colleagues and their own habits are attached to. A second tracker inside
the panel is not a fallback; it is a place work goes to be forgotten, and the
machinery that keeps it agreeing with the real one would be the most intricate
code in the product. Two sources of truth that must agree need a direction
(`pull` or `push` at link time), a failure state, a conflict state when a
remote change lands on a pending local edit, a scheduled reconciliation, a
webhook, and a rule about which fields are shared and which stay local. Every
one of those exists to service a copy, and the copy exists only because the
local row was declared canonical.

There is, though, exactly one thing Portta knows that no provider does: which
of this host's environments are running for which piece of work. GitHub does
not know an environment exists. Linear does not either. "What is this stack
running for" is a question only Portta can answer.

## Decision

> **Portta has no task of its own. A Project's work lives in GitHub or in
> Linear, and everything Portta stores about it is one string: which provider,
> and which issue there.**

### There is no local mode

A Project declares one provider — `github` or `linear` — and there is no third.
`projects.task_provider` is nullable, and null means *not chosen*, never
*local*: a Project whose repository has a GitHub remote is a GitHub project
without anybody configuring anything, and the column exists only to override
that, either by choosing Linear or by choosing GitHub for a Project whose remote
is somewhere else (`packages/server/src/services/issues/provider.ts`).

When neither applies, the panel refuses with a reason rather than returning an
empty list, because "this Project has no repository with a GitHub remote", "this
Project uses Linear but names no team" and "this Project is not linked to
anywhere its work lives" are three different things for an operator to fix.

### The reference is a string, and it is the identity

`packages/core/src/issues.ts` defines it: `github:codions-labs/portta#113`,
`linear:ENG-42`. Deliberately human-readable and stable, because it ends up in
rows nobody migrates. It carries no database id, so re-linking a repository or
re-installing Linear does not orphan anything. It is pure string work — no
network, no token, no client — and it is what `work_sessions.issue_ref`,
`activity_events.issue_ref` and `environment_issues.issue_ref` all hold.

`parseIssueRef` refuses rather than guesses. These strings arrive from a URL, a
CLI argument and an agent, and a ref that parsed "close enough" would address a
different issue than the one somebody meant. Linear identifiers are uppercased
on the way in, because the API returns them that way and a ref differing only in
case is a second row for the same issue.

### The one link Portta owns

`environment_issues` links an environment to at most one issue ref. Its
primary key is the environment: an issue may have many environments running
for it, an environment runs for at most one issue.

Stored links win outright. What is left is inferred, in one order, first match
winning: the environment's own `portta.issue` label, then its branch name, then
its namespace suffix. That order is the order of deliberateness — a label is
something somebody wrote, a namespace is something a tool generated. A label
carries a whole ref, because an environment is not inside a Project and has
nothing to resolve a bare number against; a branch and a namespace carry only a
number, so they are read relative to the Project's own repository and produce
nothing when the Project has none.

### A small interface, two implementations, no framework

Two providers are named in one file and implemented once each. There is no
registry, no plugin surface and no factory, because a framework for a set of
size two is a cost with no payer. `WorkCoordinate` is a repository slug for
GitHub and a team key for Linear — the coordinates genuinely differ, and
pretending otherwise would mean a repository-shaped argument Linear has no use
for.

The contract (`packages/contracts/src/work-types.ts`) is the *intersection* of
the two providers rather than the union: a field exists only when both can
answer it, or when the one that cannot can answer `null` honestly. That is what
keeps a `if (provider === …)` out of every panel component. Nothing in it has a
Portta id, because the ref is the identity and it is the provider's, not a row
this panel could renumber.

GitHub is served by `gh` on the host
([ADR 0018](0018-github-issues-through-the-gh-cli.md)). Linear uses the
daemon's GraphQL client (`packages/host/src/forge/linear.ts`, shared with Task
Flow) — same key, same endpoint, same error shape — with only the queries the
work surface needs. Linear has no open and closed: it has workflow states with
a *type*, and Portta projects `completed` and `canceled` onto `closed` and
everything else onto `open`, keeping the state's own name so a person still
sees "In Review" rather than a word Linear never used.

### Nothing about an issue is stored

A read is a call, projected into the contract and answered. What Portta adds on
top is the environment links, which are its own. This is the same decision as
[ADR 0018](0018-github-issues-through-the-gh-cli.md)'s "nothing is cached",
stated at the model level: there is no local issue, so there is nothing for a
cache to be a cache *of*.

## Consequences

- The panel's work surface only works when the provider is reachable and the
  host is signed in. It answers a typed failure with a hint rather than an empty
  list, so "GitHub is down" never looks like "there is no work".
- A comment written in Portta is a comment on GitHub or Linear, visible to
  everybody on the issue, attributed to the operator. There is no such thing as
  a private note attached to work.
- Subtasks, issue types, priorities, due dates and attachments are whatever the
  provider offers. Portta neither adds nor emulates them.
- There is no board. Ordering is the provider's, which for GitHub means no
  ordering at all beyond its own filters. Introducing a board would mean
  storing rank against a ref, and that is a decision this record does not make.
- The CLI has no task commands and the MCP server no issue verbs: an agent
  reads the Development Context (`portta projects context <slug> --issue
  <ref>` for one issue in full) and acts on the issue through its own tools.
- Adding a third provider means a third implementation of the same small
  interface, not a new abstraction. Nothing here is designed to make that easy,
  and that is deliberate.
