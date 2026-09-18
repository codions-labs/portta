# 0018. GitHub Issues go through the `gh` CLI on the host

**Status:** Accepted; see [0047](0047-host-daemon-and-panel-proxy.md),
[0050](0050-work-lives-in-an-external-provider.md)

## Context

The panel is a container with no `git`, no forge credential and no project
directory ([ADR 0010](0010-git-collected-on-the-host.md)). If the panel is
going to read and write issues, something has to hold a credential and make
the call. Three ways of arranging that were considered.

**A GitHub App inside the panel.** An App id, a private key on disk,
installation tokens refreshed every hour, a signed webhook endpoint and a
scheduled reconciliation. Rejected on three counts. An App is *installation*
identity: an issue Portta opened would be opened by "Portta", not by the person
who clicked the button, which is the wrong attribution for a tool one operator
runs on their own host. A webhook wants an address GitHub can reach, which
fights [ADR 0012](0012-routed-panel-access-requires-authentication.md) and
[ADR 0021](0021-panel-access-modes.md) on every installation that is not
routed. And the panel would have to be given HTTP egress, its own rate-limit
accounting and a long-lived private key in a file it can itself write — the
exact objection [ADR 0010](0010-git-collected-on-the-host.md) raises.

**A local mirror of issues**, kept current by a webhook or a schedule. Rejected
because a copy of what the provider already holds is a second source of truth,
and every mechanism that keeps it current — the schedule, the conflict state,
the binding that can be `pending` or `error` — exists only to service the copy
([ADR 0050](0050-work-lives-in-an-external-provider.md)).

**The operator's own `gh`, on the host.** [ADR 0047](0047-host-daemon-and-panel-proxy.md)
provides a daemon on the host, started by the operator, running with the
operator's own tools. The operator almost certainly already has `gh` installed
and signed in, because that is how they use GitHub from a terminal. This is the
one that makes the three costs above disappear.

## Decision

> **The panel reads and writes GitHub Issues by running `gh` on the host,
> through the host daemon. There is no GitHub App, no webhook, no scheduled
> synchronisation and no local copy of an issue.**

Two rules follow, and they are worth keeping explicit:

- **The panel holds no forge credential.** The one secret it holds for the
  daemon is the host token [ADR 0047](0047-host-daemon-and-panel-proxy.md)
  already governs.
- **Issue state is not derivable from a working directory.** That is why this
  work is not part of `portta repos scan`. `gh` is a network call; `git` is
  not; the two remain separate collectors with separate guarantees. Local
  working trees remain read-only, and no checkout, merge, rebase, fetch or
  push happens anywhere in this path.

### `gh`, not a hand-rolled client

`packages/host/src/forge/gh.ts` runs the operator's `gh` with `--json` and
parses what comes back. No REST paths are hand-rolled, no token is read, and
there is no Octokit: `gh` already knows which host a repository is on, which
account is authenticated and how to page, and reimplementing any of that would
be a second, worse client for a tool the operator has already configured.

The call is `execFile`, so no shell is involved, with `GH_PAGER=cat`,
`NO_COLOR=1` and `GH_PROMPT_DISABLED=1` — all three because `gh` decorates and
paginates when it believes it is talking to a person, and every one of those
decorations would end up in the JSON the panel parses. A call is given twenty
seconds, which is long enough for a cold `gh` on a slow network and short enough
that a hung `gh` is not a hung panel. The binary is resolved once, through the
same login-shell probe the daemon's other host tools use, because the probe is
slow and `gh` does not move; an operator who installs `gh` restarts the daemon.

Every operation takes a repository of the form `owner/name`, passed from the
panel. The daemon never infers it from a working directory: the panel knows
which Project a request is for and which repository that Project is linked to,
and a `gh` call that fell back to "whatever repository this directory is" would
write to the wrong one. The argument is anchored against a regular expression
before it is spawned — not for quoting, since `execFile` uses no shell, but
because a value beginning with `-` would be read by `gh` as a flag.

### The forge is daemon surface, not a module

`/api/forge/*` (`packages/host/src/forge/routes.ts`) is served unconditionally,
beside `/api/modules/<id>` rather than inside it. A module in
[ADR 0047](0047-host-daemon-and-panel-proxy.md)'s sense is an optional vertical
an operator switches on; reading and writing issues is what the panel's work
surface *is*, so making it optional would make the panel optional. What is
optional is whether `gh` is installed and signed in, and that is reported rather
than hidden: `GET /api/forge/status` is the question the panel asks before it
offers anything, and it never fails, because a diagnostic that fails is a
diagnostic nobody can read.

### The panel uses a typed client, not the transparent proxy

`packages/server/src/services/issues/host-client.ts` is an ordinary typed client
to `/api/forge/*`, not `createHostProxy`. The proxy forwards a request
unchanged, and the panel does not want to forward: it has to decide which
repository or team a Project means, project what the daemon answered into the
contract (`IssueSummary`, `Issue`), and fold in the environment links that are
Portta's own and that neither provider knows about. The daemon's token goes on
the request and nothing the browser sent reaches it, exactly as
[ADR 0047](0047-host-daemon-and-panel-proxy.md) requires.

The daemon's routes answer `gh`'s own shapes — camelCase, ISO dates, nested
`author` and `labels` — and keep them. The projection into the contract happens
once, in the panel, so the daemon has no opinion about how an issue is displayed
and the projection has no opinion about how `gh` is spelled.

The panel's own routes declare `issue:read` and `issue:write` from the one
permission vocabulary (`packages/auth/src/access-control.ts`), and are scoped to
a Project, which is also the authorisation boundary: somebody who cannot see a
Project cannot read its issues through them.

### Identity is the operator's, and that is the point

`gh auth` is a personal credential. An issue Portta opens and a comment Portta
posts are attributed to whoever is signed in on the host, not to an App, and the
panel says whose account that is (`GET /api/forge/status` returns the login).
This is a narrower and more honest claim than an installation token: Portta can
do exactly what the operator can do, on exactly the repositories they can see,
and revoking it is `gh auth logout` rather than uninstalling an App from an
organisation.

### Seven ways to fail, each with its own screen

`gh` exits non-zero with prose on stderr rather than a typed error, so the
daemon is where prose becomes a decision. `ForgeFailure` is `unavailable`,
`unauthenticated`, `forbidden`, `not-found`, `rate-limited`, `timeout` and
`failed`; the panel's client adds `daemon-unreachable` for the daemon itself
rather than the provider behind it. Each maps to its own HTTP status — 503, 401,
403, 404, 429, 504, 502, and 503 again — and carries its own hint: install `gh`,
run `gh auth login` on this host, this account cannot see that repository, try
again shortly, start the daemon with `portta host serve`.

Collapsing them into one "request failed" is how an operator ends up
re-authenticating to fix a 404. They are kept apart all the way to the browser
because each one is fixed a different way, and the classification is deliberate
where it is ambiguous: GitHub answers 404 for a private repository the caller
cannot see, so a "not found" on a repository somebody named is more often a
permission problem than a typo, and the message says so rather than picking one.

### Nothing is cached

An issue read twice is fetched twice. There is no table, no TTL and no
invalidation, because a mirror is precisely what this record rejects. The cost
is a `gh` call per page view; the benefit is that there is no state to be stale,
no reconciliation to schedule, no conflict to resolve and no webhook to receive.

A listing is bounded at one hundred issues, which is what a page shows.

## Consequences

- Portta has no GitHub identity of its own. Nothing can act on a repository when
  nobody is signed in on the host, and nothing acts as anybody but the operator.
  The panel reports that state instead of failing opaquely.
- Reading issues requires the host daemon to be running. A panel with no daemon
  answers 503 with the command that starts one, rather than rendering an empty
  list that looks like a repository with no issues.
- Every page that shows issues costs a `gh` call, and GitHub's rate limit is
  the operator's personal one. `rate-limited` is a first-class failure for that
  reason.
- Issues need the provider reachable. Everything that does not need the forge —
  Projects, repositories, environments, sessions, activity — is unaffected,
  which is the division [ADR 0032](0032-portta-development-model.md) draws.
- An enterprise GitHub host works if `gh` is configured for it, because `gh`
  resolves the host. Portta has no API URL setting to get wrong.
- The daemon reaches the network on the operator's behalf. That is true of
  every module it runs; what is specific here is that it does so on a route
  the panel calls on every page of the work surface, which makes
  `/api/forge/*` a review surface in the same sense as
  [ADR 0047](0047-host-daemon-and-panel-proxy.md)'s permission table.
