# CLI reference

`portta` is the installable, machine-first interface to the gateway. It is
the `@codions/portta` npm package and requires Node 24 or newer.

## Installation

```bash
npx @codions/portta --version
npm install --global @codions/portta
portta setup --dry-run
portta setup --yes
```

`setup` requires POSIX, Node 24+, network access, Docker Engine
24+ and Compose v2. It never installs system packages, invokes `sudo`, edits a
firewall or `/etc/hosts`, or overwrites an unrelated directory. It installs the
runtime assets carried by the npm package, prepares `.env` from `.env.example`
(new keys are appended, set values are kept, `PORTTA_AUTH_SECRET` is generated
when empty), ensures gateway-owned directories and the shared network, pulls
pinned images, starts the selected profile and checks that components stayed
running. Repeating it is idempotent; `--dry-run` changes nothing.

Afterwards `portta` finds the installation in `PORTTA_HOME`, `~/portta`,
`/opt/portta`, `~/.portta` or `/var/lib/portta`, or by walking up from the
current directory. See the
[installation reference](installation-reference.md).

## Global flags and streams

| Flag | Contract |
|---|---|
| `--json` | Emit the documented data object on stdout. Progress and warnings stay on stderr. |
| `-y`, `--yes` | Confirm every gated operation non-interactively. |
| `--quiet` | Suppress progress and the elapsed-time line; never suppress errors or requested data. |
| `--verbose` | Add diagnostic detail on stderr, and stream every child process's output. |
| `--profile <name>` | Select `local`, `remote-private` or `remote-public`. |
| `-h`, `--help` | Available at the root and every command level. |
| `-V`, `--version` | Prints `portta <version> (built <UTC time>)`. Available globally, including after a subcommand. |

### Progress and long operations

The CLI runs `docker`, `docker compose` and `git`. What happens to their output
is a contract, not an accident ([ADR 0034](../../development/adr/0034-child-process-output.md)):

- **Nothing is silent for long.** A child whose output is being captured
  announces itself on stderr after ten seconds and every thirty after that:
  `wait     still running: docker compose run --build … (1m20s)`. After three
  minutes it says what to do about it.
- **Work you are waiting on shows its own output.** Builds, pulls and
  `docker compose up` stream while they run.
- **Child stderr is always mirrored; child stdout is mirrored except under
  `--json`.** `docker pull` writes layer progress to stdout, and that must not
  land inside the document a machine is reading. Build progress is on stderr,
  so a `--json` run still sees it.
- **`--verbose` streams everything**, including the short probes.
- **A build is never killed on a timer.** A cold first build legitimately takes
  minutes; the elapsed-time line is there so you can decide. `Ctrl-C` during a
  build is safe — BuildKit keeps its cache.

A command that needs confirmation never prompts when stdin is not a TTY. It
exits 4 and names `--yes` instead. Programs are always executed as an
executable plus an argument array with shell expansion disabled.

### Interaction and shell completion

The CLI intentionally keeps its prompts small and dependency-free. Confirmation
is No by default, writes to stderr and is replaced by `--yes` in automation.
The core commands ship no shell completion script. The Taskflow module
registers `portta flow completion bash|zsh`, which generates one for its own
command tree.

## Exit codes

| Code | Meaning |
|---:|---|
| 0 | Success. |
| 1 | The requested operation failed. |
| 2 | Usage error: unknown command, missing argument or invalid flag. |
| 3 | Precondition missing: Docker unavailable, installation absent or gateway down. |
| 4 | Refused by a safety rule or because confirmation was not supplied. |

## Command tree

### Gateway

| Command | Command-specific flags |
|---|---|
| `setup` | `--dir`, `--dry-run`, `--skip-pull`; the global `--profile` selects the profile to start. |
| `bootstrap` | `--skip-pull` |
| `up [profile]` | `--attach`, `--demo`. `--demo` starts the panel when it is not reachable, starts every `portta-demo-*` stack in `PORTTA_PROJECTS_HOME` and registers the Project and repositories each one declares. `--local-release` is checkout only. |
| `down` | `--demo`. Without it, consumer projects keep running. With it, `PORTTA_PROJECTS_HOME/portta-demo-*` are stopped and their volumes dropped, then the gateway. |
| `restart`, `status`, `doctor`, `inspect`, `update`, `version` | Global flags only. |
| `dev [profile]`, `reset`, `build` | Checkout only: development setup from local Dockerfiles, its reset, and the local image build. See [Development setup](../../development/development-setup.md). |
| `logs [service]` | `--no-follow`, `--tail <lines>` |
| `urls` | `--project <name>` |
| `services` | Global flags only. List services in the current Compose runtime; a shortcut for `runtime status` in a project directory. |
| `compose config [path]` | Print the effective Compose model from the persisted Runtime Plan; the same result as `runtime config [path]`. |

In a project directory with a Compose file, `up`, `down`, `restart`, `status`
and `logs` operate that project's runtime instead of the gateway; `up` prepares
the Runtime Plan first when it is missing or stale.

### Projects, environments and work

Two nouns. A **Project** is the product being developed: a decision the panel
persists, so these verbs call the panel API. An **environment** is a Compose
project Docker is running: an observation, read locally.

| Command | Command-specific flags |
|---|---|
| `projects list` | Global flags only |
| `projects show <slug>` | Repositories with git state, adopted environments |
| `projects create` | `--slug`, `--name`, `--description`, `--path <dir>` (first-level directory under Projects Home) |
| `projects context <slug>` | `--issue <ref>` (`github:owner/repo#n` or `linear:ENG-42`) includes that issue in full. The Development Context an agent reads before working; `--json` carries the instruction files in full |
| `projects resolve [--path <abs>]` | Which Project a directory belongs to: the registered root, a subdirectory of it, a linked worktree, or (declared as inferred) a clone with the same remote. Reads the host and the panel, writes nothing. Fails with a named reason instead of guessing: `unknown`, `ambiguous` (the candidates are listed), `stale` (the registration points at a path that no longer exists) or `unauthorized` |
| `projects resources <slug>` | Usage attributed through the adopted environments |
| `projects activity <slug>` | `--kind <a,b>`, `--limit <n>` |
| `overview` | The Development Dashboard |
| `envs list` (`env` and `environment` are aliases) | Global flags only |
| `envs show <name>` | Global flags only |
| `envs start\|stop\|restart <name>` | Dependency order; nothing is removed. |
| `envs logs <name>` | `--service <name>`, `--tail <lines>` |
| `envs endpoints <name>` | The routed hostnames |
| `envs services` | `--project <name>` |
| `envs analyze <path>` | Read-only. `--file <path>` names the Compose file (relative to `<path>` or absolute) when it is not `compose.yaml` in `<path>`; the project directory is then the file's. |
| `envs init <path>` | `--dry-run`, repeatable `--service <name:port>`, `--file`, `--project <slug>`, `--output`, `--force`; writing needs confirmation. With `--file` the overlay is written next to that Compose file. `--project` emits `portta.project` on routed services so worktree namespaces adopt the logical Project. |
| `envs namespace` | `--path`, `--base`, `--suffix`, `--no-check` |
| `adopt <path>` | Canonical isolated Compose adoption. `--dry-run --json` reports the Runtime Plan and pending decisions without writing state. Repeat `--service <name:port>` to choose an HTTP surface; `--project <name>` sets an explicit Compose project namespace; `--remove-container-name <service>`, `--allow-shared-networks`, and `--allow-shared-volumes` record explicit compatibility decisions. `--manual` records a project-owned integration without Portta mutations. |
| `prepare [path]` | `--service <name:port>` (repeatable), `--project <name>`, `--dry-run`. Lower level: creates and validates the Runtime Plan, which is what `adopt --dry-run` runs. |
| `init [path]` | `--service <name:port>` (repeatable), `--project <name>`, `--manual`. Lower level: stores Runtime intent outside the source repository, which is what `adopt` runs. |
| `runtime up\|down\|restart\|status\|config [path]` | Reuse the validated persisted Runtime Plan; `up` reconciles stale source inputs before starting. |
| `runtime logs [path]` | `--service <name>`, `--no-follow`, `--tail <lines>` |
| `sessions list` | `--project <slug>`, `--active` |
| `sessions start` | `--project`, `--issue`, `--repository`, `--environment`, `--summary`, `--head` |
| `sessions end <id>` | `--summary`, `--abandon`, `--head` |
| `sessions heartbeat <id>` | Global flags only |
| `activity` | `--project`, `--kind`, `--issue`, `--repository`, `--environment`, `--limit` |

Every verb that calls the panel accepts `--url`, `--allow-remote` and
`--actor` (`PORTTA_ACTOR`), exactly as `portta mcp` does.

`PORTTA_URL` is the API base variable. `PORTTA_TOKEN` sends a Bearer token.

### Issues

A Project's work lives in GitHub Issues or Linear. These verbs read and write it
live through the panel and the host daemon: GitHub through the `gh` session on
the host, Linear through `LINEAR_API_KEY` on the host. Portta keeps only the
reference (`github:owner/repo#113`, `linear:ENG-42`). Every verb except
`status` requires `--project <slug>`, which decides the repository or Linear
team. A body is `--body <text>` or `--body-file <path>` (`-` reads stdin). See
[Work with issues](../guides/issues.md).

| Command | Command-specific flags |
|---|---|
| `issues list` | `--state open\|closed\|all`, `--assignee <login>`, `--label <name>`, `--milestone <title>`, `--q <text>` |
| `issues show <ref>` | The issue with its body, comments and environments |
| `issues create <title>` | `--body`, `--body-file`, `--label <a,b>`, `--assignee <a,b>`, `--milestone <title>` |
| `issues edit <ref>` | `--title`, `--body`, `--body-file`, `--add-label`, `--remove-label`, `--add-assignee`, `--remove-assignee`, `--milestone` |
| `issues close <ref>` | `--reason completed\|not-planned` |
| `issues reopen <ref>` | Global flags only |
| `issues comment <ref> [text]` | `--body`, `--body-file` |
| `issues status` | Whether this host can read and write issues |

Issue verbs accept `--url`, `--allow-remote` and `--actor` like the other panel
verbs.

### Configuration

| Command | Command-specific flags |
|---|---|
| `config prepare` | Global flags only. Create or reconcile `.env` without starting services. |
| `config list` (default; alias `ls`) | Global flags only. List the named settings and their values. |
| `config get <setting>` | Global flags only. Print one setting. |
| `config set <setting> <value>` | `--no-apply` writes the value without recreating anything. |

### Private access

| Command | Command-specific flags |
|---|---|
| `access open` | Required `--project`, `--service`; optional `--port`, `--local-port`, `--ttl`, `--network`, `--bind` |
| `access list` | Global flags only. |
| `access close [id]` | Alternatively `--project` or `--all`. |
| `access inspect <id>`, `access gc` | Global flags only. |
| `service publish` | Required `--private`, `--project`, `--service`; optional `--port`, `--alias`. `--public` is always refused. |
| `service list` | Global flags only. |
| `service unpublish [alias]` | Alternatively `--project`. |

`db open|close|url|psql|mysql` and `redis open|close|cli` are typed
conveniences over the same bridges or one-shot toolbox clients. Client
commands require `--project`, accept `--service` and `--port`, and pass trailing
arguments directly to the selected client. `psql` and `mysql` also accept
`--user` and `--database`.

`db status|migrate|shell|dump|restore` operate on the panel's own SQLite file,
`state/panel/portta.db`:

| Command | Contract |
|---|---|
| `db status` | The database file and its size. |
| `db shell` | Opens `sqlite3` on the file; needs `sqlite3` on the host. |
| `db dump [file]` | Writes a consistent copy, safely while the panel runs; default `portta-<timestamp>.db`. Needs `sqlite3`. |
| `db restore <file>` | Replaces the database. Refused while the panel runs (`portta web down` first) and asks for confirmation (`--yes`). |
| `db migrate` | Asks the running panel to apply pending SQL migrations without a restart. |

### Panel, network and integrations

| Command | Command-specific flags |
|---|---|
| `web up`, `web dev` | `--expose local\|tailscale\|vpn\|public\|domain`, `--port`, `--read-only`, `--writable`. `web dev` also enables hot reload. Only `--expose vpn` defaults to read-only; `--writable` opts out. `web` also accepts `--local-release`. |
| `web down\|disable\|restart\|status\|open\|build` | Global flags only. |
| `web logs [service]` | `web` (default), `web-socket-proxy` or `portta-auth`. |
| `auth bootstrap` | `--name`, `--email`, `--password-stdin`; creates the panel owner, once. The password is only ever read from stdin. |
| `auth login` | `--token`; omitted, the token is read from the terminal without echoing. Checked against the panel before it is saved. |
| `auth status` | Global flags only. Says the panel's mode and who this terminal is. |
| `auth logout` | Global flags only. Forgets the credential; does not revoke the token. |
| `auth whoami` | Global flags only. Never prints a token. |
| `auth token list` | `--all` for everybody's; needs `user:list`. |
| `auth token create` | `--name`, `--human`, `--scopes <a,b>`, `--expires-in-days`; the secret is shown once. |
| `auth token revoke <id>` | Global flags only. Somebody else's needs `user:update`. |
| `protect host <host>` | `--user`, `--password-stdin`, `--entrypoint`, `--label`, `--project`, `--service`; creates or rotates a protected-host record. |
| `protect status [host]` | Read-only; never returns credential hashes. |
| `protect remove <host>` | Removes the record; the consumer project's middleware label is unchanged. |
| `auth reset-password <email>` | `--password-stdin`; otherwise a password is generated and shown once. Runs inside the panel container and ends every session of that account. |
| `users list` | Global flags only. |
| `users create` | `--name`, `--email`, `--role`, `--projects`, `--password-stdin`; a generated password is shown once. |
| `users set-role <email> <role>` | Global flags only. The email is resolved to an id through the panel. |
| `users set-password <email>` | `--password-stdin`; ends every session of that account. |
| `users grant <email> <project>` | Global flags only. Sends the whole list, with this Project added. |
| `users revoke <email> <project>` | Global flags only. Sends the whole list, with this Project removed. |
| `users remove <email>` | Global flags only. |
| `network status` | `--public-ip` explicitly permits one external lookup. |
| `public status\|enable\|disable` | Enable needs confirmation; TCP services are never published. |
| `dns check\|status` | Read-only. |
| `dns setup` | `--target <ip>`, `--dry-run`; Cloudflare needs a scoped token. |
| `repos scan` | `--environment <name>`, `--path <dir>`, `--with-prs`, `--forge-ttl <seconds>`. Collects every repository (git state, the last twenty commits, the instruction files on the allowlist, and references to the decision records and specification documents it keeps) into `state/git/<key>.json` plus `state/git/index.json`, which maps each environment to the repository it runs from. The metrics watcher runs it once a minute. |
| `repos status`, `repos clear` | Inspect or remove only `state/git/*.json`. |
| `repos specs` | `--path <dir>`. The decision records (`docs/**/adr/*.md` and equivalents) and the OpenSpec or Spec Kit documents the last scan recognised, as references: path, convention, kind, title, hash, dirty. Nothing is read beyond a document's title line, and nothing is written. A repository without any lists none. |
| `host collect` | Write host/project metrics and an environment readiness report. |
| `envs report` (`env` and `environment` are aliases) | Refresh `state/environment/report.json` without changing the host. |
| `host watch` | Start the detached collector, or run it in the foreground with `--loop`. |
| `host status` | Whether the collector is running, and how old the last snapshot is. |
| `host serve` | Run the host daemon in the foreground on `PORTTA_HOST_BIND:PORTTA_HOST_PORT` (default `127.0.0.1:5111`). `--detach` starts it in the background, logging to `state/host/daemon.log`, unless one already answers. Creates `state/host/token` on first start. See [Run the host daemon](../guides/host-daemon.md). |
| `host service install` | `--env KEY=VALUE` (repeatable), `--no-auto-env`, `-y`. Installs, enables and starts the `portta-host` user service (systemd on Linux, launchd `com.portta.host` on macOS), which runs `portta host serve` from this installation. |
| `host service uninstall\|restart\|status\|logs` | Manage that service; `logs` follows it. |
| `flow <command>` | The Taskflow module's commands; `--port` selects the host daemon's port. See [the Taskflow CLI reference](../../modules/taskflow/cli.md). |
| `share list`, `share revoke <id>`, `share gc` | Shares can only be created in the panel. |
| `tls status\|init` | `init` runs OpenSSL in the toolbox container and enables TLS in `.env`. |
| `tls trust\|untrust` | Print the privileged command for this operating system; never run it. |
| `remote bootstrap <target>` | `--profile`, `--dir`, `--repo`, `--branch`, `--install-docker`, `--dry-run`. Prepares the remote host from a Git checkout: clones the repository there and runs the checkout's `./bin/portta bootstrap`. Never copies a secret, never overwrites a remote `.env`. |
| `remote status\|doctor\|urls <target>` | Read-only, over SSH. `--json` is forwarded. |
| `remote exec <target> -- <cmd>` | Runs the command there with the terminal attached. |
| `remote access open <target>` | `--project`, `--service`, `--port`, `--local-port`, `--dir`. Leaves an SSH tunnel running after the command exits. |
| `remote access list\|close` | `close` takes an id or `--all`; the remote bridge is left for the remote host to close. |
| `toolbox build` | Build or verify the pinned operational image. |
| `toolbox run <command...>` | Run an explicit command in the one-shot operational container. |
| `mcp` | `--url`, `--allow-remote`, `--actor` (default `agent`), `--docs-source local\|panel` (default `local`). Serves the panel verbs to an agent over stdio; refuses a non-loopback panel URL without the flag, because that is where a credential would be sent. See [MCP](mcp.md). |

Host key verification is never relaxed: `StrictHostKeyChecking` defaults to
`accept-new`, which records a key the first time and still refuses a *changed*
one. `PORTTA_SSH_HOST_KEY_POLICY` can tighten it; nothing in the tree sets it
to `no`, and the static checks reject that unsafe value.


### Maintenance and tunnelling

| Command | Command-specific flags |
|---|---|
| `tunnel status` (default), `enable`, `disable`, `test` | `disable --forget` also deletes the configuration and credentials. |
| `tunnel setup` | Requires `--zone`; reads the token from `--token-file` or a prompt, never from an argument (`--token` on the command line is always refused). Optional `--origin <url>`, `--apex`. |
| `tunnel logs` | `-n, --lines <count>` (default 50). |
| `backup` | `-o, --output <file>`, `--no-database`. Copies the panel database with `VACUUM INTO` (needs `sqlite3`) unless `--no-database`; the archive holds credentials and is written 0600. |
| `restore <file>` | `-f, --force`; refuses while the gateway runs without it, and always keeps a safety copy of what it replaces. |
| `repair` | `--dry-run`; never deletes data, never touches a volume. |


## JSON shapes

Every read command accepts the global `--json`. What it prints is one
envelope:

```json
{
  "schema": "envs.list",
  "version": 1,
  "data": { "instance": { "name": "portta" }, "projects": [] }
}
```

`schema` names the format and is the command's path below `portta`, with
its canonical name (`env list` and `envs list` both print `envs.list`).
`version` is an integer that moves only on an incompatible change to that
command's `data`: a field removed, a type changed, or a meaning changed.
Adding an optional field is not one. A consumer checks `schema` and
`version` before reading `data`, and refuses what it does not understand.
Every schema is at version 1; a bump is recorded in the changelog. The
`portta flow` commands of the Taskflow module print their own JSON without
this envelope.

The table lists the stable top-level fields of `data`:

| Command | Top-level data |
|---|---|
| `status` | `version`, `instance`, `profile`, `domain`, `bindAddress`, `network`, `components`, `projectCount`, `routeCount`, `tls`, `public` |
| `doctor` | `ok`, `instance`, `checks[]` (`id`, `status`, `message`, optional `fix`) |
| `urls` | `instance`, `routes[]` (`project`, `service`, `container`, `hostname`, `url`, `port`, `state`) |
| `inspect` | `profile`, redacted `configuration`, `composeFiles` |
| `envs list` | `instance`, `projects[]` (`name`, `state`, `serviceCount`, `urls`) |
| `envs show` | `instance`, `name`, `state`, `services`, `urls` |
| `envs services` | `instance`, `services[]` |
| `envs logs` | `lines[]` (`service`, `line`, `stream`) |
| `envs analyze` | `path`, `compose_file`, `gateway_overlay`, `project`, `domain`, `services`, `findings` |
| `envs namespace` | `namespace`, `base`, `suffix` |
| `projects list` | `projects[]` (`ProjectSummary` of the API) |
| `projects show` | the API's `Project` |
| `projects context` | the API's `DevelopmentContext`, which names its own `schema` (`development-context`) and `version` inside `data`; see [MCP reference](mcp.md#the-development-context) for the fields |
| `projects resolve` | `resolved`, `path`, `basis` (`root`, `subdirectory`, `worktree`, `remote`), `certain`, `project` (`id`, `slug`, `name`), `repository` (`id`, `name`, `path`, `remoteUrl`), `git` (`root`, `branch`, `remote`), `worktree` (`path`, `mainPath`); on failure `error` (`kind`, `message`, `hint`, `candidates[]`) with exit 1 (`unknown`, `ambiguous`), 3 (`stale`) or 4 (`unauthorized`) |
| `projects resources` | the API's `ProjectResources` |
| `overview` | the API's `DevelopmentOverview` |
| `sessions list` | `sessions[]` (`Session`) |
| `activity` | `events[]` (`ActivityEvent`) |
| `access list` | `bridges[]` (`id`, `project`, `service`, `target_port`, `local_port`, `kind`, `expires`, `bind`, `network`, `state`) |
| `service list` | `forwarders[]` |
| `web status` | `enabled`, `devMode`, `readOnly`, `expose`, `url`, `panel`, `socketProxy` |
| `network status` | `instance`, `bindAddress`, `publicIp`, `bindings`, `publicBindings` |
| `public status` | `enabled`, `profile`, `domain`, `bindAddress` |
| `dns check` | `domain`, `hostname`, `addresses`, `resolves` |
| `dns status` | `enabled`, `zone`, `domain`, `tokenSet` |
| `repos status` | `collectedAt`, `home`, `repositories[]` (`key`, `path`, `name`, `remote`, `location`, `relativePath`, `branch`, `dirty`, `environments[]`, `ageSeconds`) |
| `repos specs` | `collectedAt`, `repositories[]` (`key`, `path`, `name`, `collectedAt`, `specifications[]` — each a `SpecificationReference` of the API: `path`, `provider` (`adr`, `openspec`, `spec-kit`), `kind`, `title`, `sizeBytes`, `modifiedAt`, `sha256`, `dirty`) |
| `repos scan` | `index` (the written index) and `repositories[]` (each collected file) |
| `share list` | `shares[]` |
| `db status` | The panel database's state |
| `db migrate` | `applied[]`, `migrations[]` |
| `tls status` | `enabled`, `mode`, `domain`, `certificate`, `authority`, `acme` |
| `tunnel status` | `state`, `detail`, `hint`, `zone`, `wildcard`, `tunnel`, `connector`, `credential` |
| `tunnel setup` | `zone`, `tunnel`, `origin`, `routes[]`, `dns` (`type`, `name`, `target`, `proxied`) |
| `tunnel test` | `host`, `code`, `ok`, `detail`, `hint` |
| `backup` | `file`, `size`, `paths[]`, `database` |
| `repair --dry-run` | `dryRun`, `changes[]` |
| `remote access list` | `tunnels[]` (`id`, `pid`, `target`, `project`, `service`, `remotePort`, `localPort`, `started`, `address`) |

Fields are additive within `0.x`; incompatible changes are called out in the
changelog. Secret values never appear in JSON.

## Documentation

The CLI includes the documentation compiled for its version. These commands need neither a running panel nor internet access:

```bash
portta docs list
portta docs search "custom domain"
portta docs show addresses-and-access --anchor dns
portta docs search "schema" --audience developer --limit 5 --json
```

`list` and `search` accept `--audience user|developer|all` (default `all`). Search accepts `--limit` from 1 to 50 (default 10). `show` accepts a stable slug and optional heading anchor; it includes nested headings up to the next sibling section. Missing documents and anchors are errors.

To read the version installed on a particular panel:

```bash
portta docs search "TLS" --url http://127.0.0.1:8081
```

`--url` explicitly selects the panel. Remote non-loopback URLs also require `--allow-remote`; existing Portta token/login configuration applies. Failure does not fall back to local content. JSON output includes `origin`, corpus version, revision when available and a content hash.

The source is Markdown shared with `/docs`, the documentation API and the MCP tools. See [Use the Portta API](../guides/use-api.md) and [MCP reference](mcp.md).
