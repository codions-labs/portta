# 0016. State that could be shared, and what must never be

**Status:** Accepted

This record classifies state and decides identity. **No synchronisation is
implemented.** Two gateways know nothing about each other. What keeps that
possible later is small: a few nullable columns, one instance row, and
`updated_at` on every decision table. This page says what those seams are for,
and what they are not for.

## Context

Two Porttas, one person: a laptop and a development VPS, with the same
repositories checked out on both. Name a project *Storefront* on the laptop,
give it a short hostname, and none of that exists on the VPS — where an agent
may be doing the actual work.

The appealing version of this is "sync the gateways". The correct version is
narrower: **most of what a gateway knows is true only of the machine it runs
on**, and trying to share it would be actively wrong. A container id, a
loopback port, an absolute path and a Docker network are facts about one host.

The schema carries `instance.id` (a UUID), `environments.repo_url`,
`environments.repo_subpath` and `projects.slug`, with `updated_at` on every
decision table. [ADR 0014](0014-monorepo-and-the-typescript-cli.md) places
persistent decisions behind the panel API; this record says which of those
decisions could ever travel.

This is not a multi-host dashboard. Sharing an administrative decision is not
the same feature as showing another machine's containers.

## Decision

> **Share what a person decided about a project. Never share what a machine
> observed.**

### Five kinds of state

| Kind | Examples | Source | Shareable |
|---|---|---|---|
| **Runtime** | container ids, state, health, uptime, published ports, networks, mounts, working_dir, access-bridge ports, Traefik routers and their live status, Docker logs and stats | Docker Engine, Traefik API, kernel-allocated ports | **Never.** Re-derived in milliseconds and wrong anywhere else |
| **Instance** | bind address, domains, TLS mode, profile, ACME, `TS_AUTHKEY`, `CF_DNS_API_TOKEN`, the session secret, `COMPOSE_PROJECT_NAME` of the gateway itself | `.env` | **Never.** Host-specific, and half of it is secret |
| **Project** | display name, description, primary service, hidden services, ordering, notes, `repo_url` / `repo_subpath` / `slug` | the panel's SQLite database (`projects`, `environments`, `project_settings`, `service_settings`) | **Yes**, with the identity rules below |
| **User** | theme, default page, table density | the panel's SQLite database (`settings`) | **Yes**, and low stakes either way |
| **Shareable, with translation** | hostname alias | the panel's SQLite database (`service_settings.alias`) plus a generated Traefik file | **Partly** — see aliases |

Git snapshots under `state/git/` and host metrics under `state/metrics/` are
runtime observations collected on the host
([ADR 0010](0010-git-collected-on-the-host.md)). They are not shareable as a
source of truth; `repo_url` extracted from a Git file is a portable
*coordinate*, which is a different column doing a different job.

Share records (temporary extra hostnames with expiry) are instance-scoped:
they bind a live container name to a host-specific domain. They are not
project decisions.

An issue is not a decision and not a Docker observation, and it is not
persisted either: [ADR 0018](0018-github-issues-through-the-gh-cli.md) reads one
through `gh` at request time and stores nothing. There are therefore no rows to
share and no projection to keep in step — each instance asks the provider
itself, with whichever account is signed in on its own host. The issue *ref*
(`github:owner/repo#113`) that a session or an environment carries is shareable
in the same sense a repository remote is: it names the same thing everywhere
([ADR 0050](0050-work-lives-in-an-external-provider.md)).

`COMPOSE_PROJECT_NAME` of a *consumer* environment is local identity, not
shareable on its own: `storefront` on the laptop and `storefront` on the VPS
are probably the same project, and `storefront-issue59` is a worktree that
may not exist remotely at all.

### Project identity

Not a distributed identity system. A **local id plus portable coordinates**:

```text
projects
  id               INTEGER PRIMARY KEY   local, never shared, never meaningful elsewhere
  slug             TEXT                  a stable, user-visible name, unique per instance

environments
  compose_project  TEXT UNIQUE    the namespace, per ADR 0006 — local identity
  working_dir      TEXT NULL      local only
  repo_url         TEXT NULL      normalised remote: github.com/owner/repo
  repo_subpath     TEXT NULL      for a monorepo package
```

`(repo_url, repo_subpath)` is the portable coordinate. `slug` is the fallback
for a project with no Git, and the manual association two people (or two
gateways) can agree on.

The worktree case: `storefront` and `storefront-issue59` share a `repo_url`
and differ in `compose_project`. Sharing, if it is ever built, operates on
the repository coordinate. Per-environment overrides stay local.
[ADR 0013](0013-what-the-panel-persists.md) forbids two worktrees from
inheriting each other's aliases.

Nothing merges. `repo_url` is a coordinate, not a key.
`compose_project` stays the local identity.

### `repo_url` normalisation

A pure function. Inputs that denote the same repository must compare equal.
Covered forms, with examples:

| Input | Normalised |
|---|---|
| `git@github.com:acme/storefront.git` | `github.com/acme/storefront` |
| `https://github.com/acme/storefront` | `github.com/acme/storefront` |
| `https://github.com/acme/storefront.git` | `github.com/acme/storefront` |
| `ssh://git@github.com/acme/storefront.git` | `github.com/acme/storefront` |
| `git@gitlab.com:acme/storefront.git` | `gitlab.com/acme/storefront` |
| `https://git.example.com/acme/storefront.git` | `git.example.com/acme/storefront` |
| empty / no remote | `null` |

Rules:

1. Strip the scheme (`git+ssh://`, `ssh://`, `https://`, `http://`).
2. Strip a leading `git@` user and rewrite `host:path` to `host/path`.
3. Strip a trailing `.git`.
4. Strip a trailing slash.
5. Lowercase the host. Do **not** lowercase the path: some forges are
   case-sensitive, GitHub is not, and over-normalising merges distinct
   repositories on a self-hosted forge.
6. Drop a trailing `.wiki.git` or `/issues` suffix; those are not the
   repository.
7. Submodules are separate repositories with their own remotes; a consumer
   project's `repo_url` is the superproject, and `repo_subpath` names a
   package inside it, not a submodule.
8. No remote, or a remote that is a local path, yields `null`. `slug` then
   carries identity if a person supplies one.

The function is pure string work, with no network and no process, and is
tested with a fixture table covering every row above.

### Instance identity

A singleton `instance` row: a generated UUID that never changes, a
human-chosen `name` (default `portta`), `created_at` and `updated_at`.

That is enough. `portta status --json` names the instance, and the metrics
snapshot the host collector writes carries `instance.id`, so two gateways can
be told apart the day there are two. The UUID is local. It is not a tracking identifier, and nothing transmits it
anywhere.

`updated_by_instance` on eligible rows is **not** added. It is a sync column,
and this record forbids shipping sync machinery.

### Aliases are labels, not hostnames

`shop.localhost` on a laptop; `*.dev.example.com` on a VPS. A shared alias
cannot be a hostname.

The stored value is a **DNS label**: `shop`. Each instance renders it against
its own `PORTTA_DOMAIN`, `PRIVATE_DOMAIN` or `PUBLIC_DOMAIN`. The
laptop serves `shop.localhost`, the VPS serves `shop.dev.example.com`, and
nothing shared contains a hostname.

The service settings catalogue matches this: `SERVICE_KEYS.alias` is a
lowercase DNS label (letters, digits, hyphens, at most 63 characters), not a
FQDN. Keep it that way. Rendering the hostname is instance-local and happens
when the Traefik file is written, not when the preference is stored.

## Consequences

- Two gateways know nothing about each other.
- Anyone proposing synchronisation later starts from a page that already
  says what may be shared and what identifies a project across machines.
- If it is never built, the cost was a few nullable columns and one table
  that makes `portta status --json` able to say which gateway answered.
- Runtime state must not leak into "shareable". A review check on every new
  column: is this a decision a person made, or an observation a machine
  made?

## What this record forbids

No synchronisation code, no sync table, no `updated_by_instance` column, and
no network call between instances.
