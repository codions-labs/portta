# 0010. Git is collected on the host, and the panel only reads the result

**Status:** Accepted; see [0018](0018-github-issues-through-the-gh-cli.md) for issues, [0032](0032-portta-development-model.md) for what is collected

Issues are read and written through `gh` on the host daemon
([ADR 0018](0018-github-issues-through-the-gh-cli.md)); this record covers Git.

## Context

Opening `base-empresarial-issue59` in the panel says it is a second worktree of
`base-empresarial` and nothing else. Which branch it is on, whether there is
uncommitted work, and which pull request it belongs to are all questions people
answer by leaving the panel for a terminal.

The panel cannot answer them by itself, and the reason is structural rather
than missing code. Its container gets a handful of explicit host paths and no
project directory, ships no `git`, no `gh` and no Docker CLI, runs no shell
commands, and reaches Docker through a proxy and an allowlist that admit no
`archive`, no `prune` and no exec shape it did not build itself
([ADR 0008](0008-web-panel-socket-proxy.md)). The one container it may create
has a fixed shape with no binds at all.

What it does already hold is the host path of every project: Compose writes
`com.docker.compose.project.working_dir` on every container, and
`packages/server/src/services/inventory.ts` reads it. The panel knows exactly
where each repository is. It just cannot look.

Every way of letting it look costs a guarantee:

**Mounting the project directories** is the obvious one and the worst. It
contradicts [ADR 0001](0001-decoupled-infrastructure.md) in as many words, and
it hands a container that may be routed over a VPN read access to every
project's source, `.env` files and credentials. On a VPS that is the machine.

**Running `git` inside a project container over exec** is arbitrary command
execution in someone else's container, from a component reachable over a
network, and it usually does not even work: most project images carry no
`git`, and the repository is frequently not mounted into them.

**Generalising container creation** to spawn a short-lived `git` container with
a bind mount is the one that sounds reasonable. `createBridge` forbids binds by
construction; loosening it turns "one fixed shape" into "any host path into a
container", which is the single thing ADR 0008 exists to prevent.

**Calling a forge API from the panel with a token in `.env`** avoids the
filesystem entirely, and buys a long-lived credential in a file the panel
itself can write, egress from a container that has none, and our own
rate-limit accounting.

## Decision

Invert it. The component that already runs on the host, already has `git`, and
already knows every project's directory is the CLI.

`portta repos scan` reads the Compose labels, walks to each project's
working directory, runs read-only `git` there, and writes one file per
repository under `state/git/`, mode `600`, plus an index that maps each
environment to the repository it runs from.
`docker/compose/features/web.yaml` mounts that directory into the panel
read-only, and `GET /api/environments/:project/git` and
`GET /api/repositories/:id/git` read the files.

```
portta repos scan        host: labels -> working_dir -> git -> gh
        |
   state/git/<repository>.json + index.json   mode 600
        |
   ./state/git:/app/state/git:ro
        |
   GET /api/environments/:project/git
   GET /api/repositories/:id/git
```

Four things follow from that, and each is a decision of its own.

**Local `git` is the primary source, and `gh` is optional on top.** Branch,
HEAD, dirty counts, ahead/behind and the remote URL come from `git status
--porcelain=v2 --branch` and one `rev-list`, which need no network and no
authentication and work for every forge and for no forge at all. Repository,
commit and branch web URLs are derived from the remote URL by string work, so
GitHub, GitLab, Bitbucket and self-hosted remotes all get links. Open pull
requests come from `gh pr list --json` under an explicit `--with-prs`, reusing
the developer's existing authentication: no token in `.env`, nothing to leak
from a panel that may be routed, no rate limit of ours to account for. Pull
requests are collected only with `--with-prs`; issues are not collected here at
all ([ADR 0018](0018-github-issues-through-the-gh-cli.md)).

**The data is a snapshot, and the panel says so.** Nothing in the panel polls.
The scan runs from `portta up`, from `portta web up`, by hand, from a cron the
user writes, and once a minute from the metrics collector (`portta host
watch`). Every file carries `collectedAt`; the panel renders the age, marks
anything past a threshold as stale, and prints the exact host command to
refresh it. That is the same honesty `doctor` and the pending-settings banner
already apply.

**Metadata, and the instruction files an agent reads.** Branch names, commit
subjects, counts and URLs, the last twenty commits as metadata, and the
content of the instruction files on the allowlist in
`packages/core/src/repos-scan.ts`, bounded per file
([ADR 0032](0032-portta-development-model.md)). Never a diff, never an
arbitrary file, never a `.env`, never a credential.

**Read-only, in both directions.** No checkout, merge, rebase, reset, stash,
fetch or push; no PR approval or merge; no write to any repository from this
path. The gateway observes environments, it does not drive them.

Alongside it, three **optional** labels let a project declare what cannot be
derived, extending `LABELS` in `packages/server/src/services/labels.ts`:

| Label | What it settles |
|---|---|
| `portta.project` | The logical project, when `COMPOSE_PROJECT_NAME` is a per-worktree namespace, so several worktrees group under one heading |
| `portta.repo` | `owner/name` or a remote URL, which gives forge links with no host-side Git at all |
| `portta.git.root` | The repository root, when the Compose file is not at it (see [monorepos.md](../../product/guides/monorepos.md)) |

Every one of them is optional. The inference (`workingDir`, and a `namespace`
derived when the directory basename disagrees with the project name) is the
fallback, and a project that sets none behaves exactly as one that predates
the labels. That is asserted in the test suite, not just promised here.

## Consequences

The panel gains Git without gaining a single new capability: no project
directory is mounted into it, container creation keeps its one shape, and the
mount is read-only and contains nothing but what the scan chose to write.

The cost is freshness. What the panel shows is as true as the last scan, and it
will sometimes be wrong. The mitigation is to never imply otherwise: the age is
on screen, staleness is marked, and the refresh command is one copy away.

`state/git/` is a host path with a failure mode of its own: it is written by
the CLI as the invoking user and read by a container that may run as `node`.
`PORTTA_WEB_USER` exists for the same reason on `.env`, and the scan makes the
directory `700` and each file `600`.

There is a second reason the ordering matters. Branch names, commit subjects
and PR titles are more sensitive than container names, and this makes the panel
an inventory of what is being worked on as well as what is running. That is
why routed access requires authentication
([ADR 0012](0012-routed-panel-access-requires-authentication.md)).

A project that uses no Git degrades to no Git card. A repository with no
remote loses the links and keeps the branch. A detached HEAD says so. A
non-GitHub remote keeps its derived links and has no pull requests. None of
those is an error, and the tests enumerate them.
