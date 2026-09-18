# Connect GitHub

Portta talks to GitHub by running your own `gh` CLI on the host, signed in with
`gh auth login`. There is nothing to register on GitHub and no credential to
give Portta: the panel asks the host daemon, the daemon runs `gh`, and the
answer goes straight to the page. See
[ADR 0018](../../development/adr/0018-github-issues-through-the-gh-cli.md).

## What Portta reads and writes

| What | Through | Where it shows |
|---|---|---|
| A Project's issues: list, one issue with its comments, labels, assignees and milestones | the host daemon running `gh` | the Project's **Issues** tab, `portta issues`, `portta mcp` |
| Opening, editing, closing, reopening and commenting on an issue | the host daemon running `gh` | the same places |
| Whether `gh` is installed and which account is signed in | the host daemon; `portta doctor` runs `gh` itself | **Settings → Integrations**, `portta issues status`, `portta doctor` |
| Open pull requests of a repository | `portta repos scan --with-prs` on the host | the repository page in the panel |

Everything else about a repository — branch, commits, working tree — is read
from local Git by the host scan and needs no GitHub access at all.

## What this buys, and what it costs

`gh` already knows which account is authenticated and how to page. Portta reuses all of that instead of keeping a
second, worse client for a tool you have already configured. The consequences
are worth stating plainly:

- **Identity is yours.** An issue Portta opens and a comment Portta posts are
  attributed to the account signed in on the host, not to a bot. Portta can do
  exactly what you can do, on exactly the repositories you can see.
- **Nothing is stored.** An issue read twice is fetched twice. There is no
  mirror to go stale, and no offline reading.
- **The rate limit is your personal one**, and running out is a typed error
  rather than an empty page.

## Set it up

### 1. Install `gh` on the host

The daemon runs it, so it has to be on the machine running `portta host serve` —
not inside the panel's container, which has no `gh`, no PATH to your tools and
no credential.

```bash
gh --version
```

If that prints nothing, install it from [cli.github.com](https://cli.github.com).

### 2. Sign in

```bash
gh auth login
gh auth status
```

The daemon resolves `gh` through a login-shell probe, so a `gh` installed by
Homebrew, by a package manager or into a user prefix is found the way your own
shell finds it. The path is resolved once and remembered, because the probe is
slow and `gh` does not move — if you install `gh` while the daemon is already
running, restart it.

### 3. Make sure the daemon is running

```bash
portta host serve --detach     # or portta host service install
```

See [Run the host daemon](host-daemon.md). Without it the panel answers `503`
with the command that starts one, rather than rendering an empty list.

### 4. Point a Project at a repository

Nothing else is needed. A Project whose repository has a GitHub remote is a
GitHub project, without any setting being written: the remote is the whole link,
and `owner/name` is parsed from it when a call needs it.

The Project's stored provider exists only to override that — to choose Linear
instead, or to choose GitHub for a Project whose remote is somewhere else.

### 5. Check it

```bash
portta issues status
portta doctor
```

**Settings → Integrations** and `GET /api/issues/status` answer the same
question: whether this host can operate GitHub, and the account it is signed in
as. `doctor` warns when `gh` is missing or nobody is signed in.

![Authentication disabled: Settings Integrations showing GitHub not signed in with gh auth login as the fix, and LINEAR_API_KEY not set on this host](../../images/auth-disabled-settings-integrations.png)

**Authentication disabled** — Settings, Integrations on a host where nobody ran
`gh auth login`.

## What runs, exactly

Every call is a `gh` subcommand — `gh issue`, `gh label` and `gh api` — whose
JSON the daemon parses. Portta reads no token and bundles no GitHub client
library. The daemon spawns it without a shell, with paging and
colour turned off — `gh` decorates when it believes it is talking to a person,
and every decoration would end up in the JSON the panel parses — and gives it
twenty seconds, which is long enough for a cold call on a slow network and short
enough that a hung `gh` is not a hung panel.

The repository always comes from the panel, never from a working directory. The
daemon does not guess: the panel knows which Project a request is for and which
repository that Project is linked to, and a `gh` call that fell back to
"whatever repository this directory is" would write to the wrong one.

## Permissions

There are none to grant. Whatever your `gh` account can do on a repository is
what Portta can do there, and revoking it is `gh auth logout`. Nothing in Portta
writes code: no checkout, merge, rebase, fetch or push happens on this path, and
local working trees stay read-only
([ADR 0010](../../development/adr/0010-git-collected-on-the-host.md)).

Inside the panel, issue routes carry the `issue:read` and `issue:write`
permissions and are scoped to a Project, so somebody who cannot see a Project
cannot read its issues. Read-only mode removes the writes like any other
mutation.

## When it does not work

| What you see | Why | Fix |
|---|---|---|
| `503`, *the GitHub CLI is not installed on this host* | the daemon cannot find `gh` on any PATH it can see | install it, then reload; restart the daemon if the install came after it started |
| `503`, *the host daemon is not reachable* | nothing is serving | `portta host serve`, or `portta host service install` |
| `401` | `gh` is installed but nobody is signed in | `gh auth login` on the host |
| `403` | signed in, but not for this repository | an account that can see it |
| `404` | no such repository or issue — or a private one this account cannot see, which GitHub also answers `404` for | check the reference, then check the account |
| `429` | GitHub is rate-limiting this account | wait; the budget is personal |
| `504` | the call took longer than twenty seconds | retry |
| `409` | the Project names nowhere its work lives | add a repository with a GitHub remote, or choose Linear |

Each of these keeps its own status and its own hint all the way to the browser,
because each is fixed a different way. None of them affects the rest of the
panel: a GitHub failure never stops a Docker-backed page from answering.

## See also

- [Work with issues](issues.md) for the day-to-day surface.
- [Work and issues](../concepts/work-and-issues.md) for the model and its
  trade-offs.
- [Security](../concepts/security.md) for what the panel is and is not allowed
  to reach.
