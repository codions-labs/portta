# 0016. State that could be shared, and what must never be

**Status:** Accepted

This record classifies state and decides identity. **No synchronisation is
implemented.** Two gateways know nothing about each other. What keeps that
possible later is small: a project slug, one instance row, and `updated_at` on
every decision table. This page says what those seams are for,
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

The schema carries `instance.id` (a UUID) and `projects.slug`, with
`updated_at` on every decision table. [ADR 0014](0014-monorepo-and-the-typescript-cli.md) places
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
| **Project** | display name, description, primary service, hidden services, ordering, notes, `slug` | the panel's SQLite database (`projects`, `environments`, `project_settings`, `service_settings`) | **Yes**, with the identity rules below |
| **User** | theme, default page, table density | the panel's SQLite database (`settings`) | **Yes**, and low stakes either way |
| **Shareable, with translation** | hostname alias | the panel's SQLite database (`service_settings.alias`) plus a generated Traefik file | **Partly** — see aliases |

Host metrics under `state/metrics/` are runtime observations collected on the
host. They are not shareable as a source of truth.

Share records (temporary extra hostnames with expiry) are instance-scoped:
they bind a live container name to a host-specific domain. They are not
project decisions.

`COMPOSE_PROJECT_NAME` of a *consumer* environment is local identity, not
shareable on its own: `storefront` on the laptop and `storefront` on the VPS
are probably the same project, and `storefront-review` is a worktree that
may not exist remotely at all.

### Project identity

Not a distributed identity system. A **local id plus a portable name**:

```text
projects
  id               INTEGER PRIMARY KEY   local, never shared, never meaningful elsewhere
  slug             TEXT                  a stable, user-visible name, unique per instance
  relative_path    TEXT NULL             the project's directory under Projects Home

environments
  compose_project  TEXT UNIQUE    the namespace, per ADR 0006 — local identity
  working_dir      TEXT NULL      local only
```

`slug` is the manual association two people (or two gateways) can agree on.
`relative_path` and `working_dir` are paths on one host and never travel.

The worktree case: `storefront` and `storefront-review` differ in
`compose_project`. Per-environment overrides stay local.
[ADR 0013](0013-what-the-panel-persists.md) forbids two worktrees from
inheriting each other's aliases.

Nothing merges. `slug` is a name, not a key. `compose_project` stays the local
identity.

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
- If it is never built, the cost was one table
  that makes `portta status --json` able to say which gateway answered.
- Runtime state must not leak into "shareable". A review check on every new
  column: is this a decision a person made, or an observation a machine
  made?

## What this record forbids

No synchronisation code, no sync table, no `updated_by_instance` column, and
no network call between instances.
