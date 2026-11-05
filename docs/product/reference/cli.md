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
The CLI ships no shell completion script.

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
| `up [profile]` | `--attach`, `--demo`. `--demo` starts the panel when it is not reachable, starts every `portta-demo-*` stack in `PORTTA_PROJECTS_HOME` and registers the Project each one declares. `--local-release` is checkout only. |
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

### Projects and environments

Two nouns. A **Project** is the product being developed: a decision the panel
persists, so these verbs call the panel API. An **environment** is a Compose
project Docker is running: an observation, read locally.

| Command | Command-specific flags |
|---|---|
| `projects list` | Global flags only |
| `projects show <slug>` | The Project with its adopted environments |
| `projects pin <slug>` / `projects unpin <slug>` | Keep a Project at the top of the list, or stop |
| `projects tag <slug>` | `--add <tag...>`, `--remove <tag...>`, `--clear`; with none, prints the tags |
| `projects create` | `--slug`, `--name`, `--description`, `--path <dir>` (directory under Projects Home: relative to it at any depth, an absolute path, or `.` for the current one), `--environments <a,b>` (adopt these environments by hand, running or remembered) |
| `projects resolve [--path <abs>]` | Which Project a directory belongs to: the registered root, a subdirectory of it, or a linked worktree. Reads the host and the panel, writes nothing. Fails with a named reason instead of guessing: `unknown`, `ambiguous` (the candidates are listed) or `unauthorized` |
| `projects resources <slug>` | Usage attributed through the adopted environments |
| `envs list` (`env` and `environment` are aliases) | Global flags only |
| `envs show <name>` | Global flags only |
| `envs start\|stop\|restart <name>` | Dependency order; nothing is removed. |
| `envs logs <name>` | `--service <name>`, `--tail <lines>` |
| `envs endpoints <name>` | The routed hostnames |
| `envs services` | `--project <name>` |
| `envs analyze <path>` | Read-only. `--file <path>` names the Compose file (relative to `<path>` or absolute) when it is not `compose.yaml` in `<path>`; the project directory is then the file's. |
| `envs namespace` | `--path`, `--base`, `--suffix`, `--no-check` |
| `envs hostname` | Required `--project <namespace>` and `--service <service>`; optional `--context` and `--domain`. Prints the canonical DNS label, or the full hostname when a domain is given. Reads no Docker state. |
| `adopt <path>` | Canonical isolated Compose adoption. `--dry-run --json` reports the Runtime Plan and pending decisions without writing state. Repeat `--service <name:port>` to choose an HTTP surface; `--project <name>` sets an explicit Compose project namespace; `--remove-container-name <service>`, `--allow-shared-networks`, and `--allow-shared-volumes` record explicit compatibility decisions. `--manual` records a project-owned integration without Portta mutations. On a public host, `--protect <service>` asks for a generated credential (printed once) and `--public <service>` lets everybody open it; adopt stops with a pending `public_exposure` until every routed service has one. |
| `runtime up\|down\|restart\|status\|config [path]` | Reuse the validated persisted Runtime Plan; `up` reconciles stale source inputs before starting. |
| `runtime logs [path]` | `--service <name>`, `--no-follow`, `--tail <lines>` |

Every verb that calls the panel accepts `--url`, `--allow-remote` and
`--actor` (`PORTTA_ACTOR`).

`PORTTA_URL` is the API base variable. `PORTTA_TOKEN` sends a Bearer token.

### Agents

| Command | Command-specific flags |
|---|---|
| `agent context` | Read-only and offline; always exits 0, prints no secret and finishes in under a second. Says where a directory stands on this host: `--path <dir>` (default: the current directory), `--home <dir>` (where `scope.yaml` is read from), `--format text\|hook`. `--format hook` prints at most 15 lines for an agent's context, and nothing on a machine without a Portta installation. The `scope` is the first row that matches: `no-portta`, `excluded` (a path in `~/.config/portta/agents/scope.yaml`), `out-of-scope`, `non-compliant`, `compliant`, `needs-adoption`, `needs-dockerizing`. The installation is found from `PORTTA_ROOT`, `PORTTA_HOME` or a well-known location, never by walking up from the directory. |
| `agents install [agents...]` | Writes the Portta layer for the agents found here (`claude`, `codex`, `opencode`, `pi`); name agents to install for those even when not found. `--dry-run`, `--home <dir>` (wins over `CLAUDE_CONFIG_DIR` and `CODEX_HOME`). Idempotent. |
| `agents status [agents...]` | Compares what is installed with what should be. `--home <dir>`. |
| `agents uninstall [agents...]` | Removes only the marker blocks, the hook entries that name `portta/agents/hook.sh` and the files the installer created. `--dry-run`, `--home <dir>`. Shared skills and the hook script go only when no agent is named. |

The layer is an instruction in a `<!-- BEGIN PORTTA -->` block of the agent's
global file, a `SessionStart` hook (Claude Code and Codex) or an extension (Pi)
that runs `agent context --format hook`, and the skills in `~/.agents/skills`.
`portta doctor` warns about an agent installed without it. Codex runs a new hook
only after you review it in `/hooks`. To check it by hand, follow
[Smoke test the agent layer](../../development/agents-smoke.md).

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

### Panel, network and host

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
| `protect open <host>` | `--entrypoint`, `--label`, `--project`, `--service`; records that everybody may open the host, with no login. Takes effect at once, with no container recreated. |
| `protect status [host]` | Read-only; never returns credential hashes. |
| `protect remove <host>` | Removes the decision. On a public host the site is closed afterwards, because no record means closed. |
| `auth reset-password <email>` | `--password-stdin`; otherwise a password is generated and shown once. Runs inside the panel container and ends every session of that account. |
| `users list` | Global flags only. |
| `users create` | `--name`, `--email`, `--role`, `--projects`, `--password-stdin`; a generated password is shown once. |
| `users set-role <email> <role>` | Global flags only. The email is resolved to an id through the panel. |
| `users set-password <email>` | `--password-stdin`; ends every session of that account. |
| `users grant <email> <project>` | Global flags only. Sends the whole list, with this Project added. |
| `users revoke <email> <project>` | Global flags only. Sends the whole list, with this Project removed. |
| `users remove <email>` | Global flags only. |
| `network status` | `--public-ip` explicitly permits one external lookup. |
| `public init` | `--domain <d>` and `--email <a>` required; `--panel-host` (the domain or one label under it, covered by the wildcard certificate), `--ip` (DNS records only), `--cloudflare-token-stdin` (one line, never an argument), `--dry-run`. Writes the public-server keys, starts nothing, needs confirmation. |
| `public status\|enable\|disable` | Enable needs confirmation; TCP services are never published. |
| `dns check\|status` | Read-only. |
| `dns setup` | `--target <ip>`, `--dry-run`; Cloudflare needs a scoped token. |
| `host collect` | Write host/project metrics and an environment readiness report. |
| `envs report` (`env` and `environment` are aliases) | Refresh `state/environment/report.json` without changing the host. |
| `host watch` | Start the detached collector, or run it in the foreground with `--loop`. |
| `host status` | Whether the collector is running, and how old the last snapshot is. |
| `share list`, `share revoke <id>`, `share gc` | Shares can only be created in the panel. |
| `tls status\|init` | `init` runs OpenSSL in the toolbox container and enables TLS in `.env`. |
| `tls trust\|untrust` | Print the privileged command for this operating system; never run it. |
| `toolbox build` | Build or verify the pinned operational image. |
| `toolbox run <command...>` | Run an explicit command in the one-shot operational container. |

### Maintenance and tunnelling

| Command | Command-specific flags |
|---|---|
| `tunnel status` (default), `enable`, `disable`, `test` | `disable --forget` also deletes the configuration and credentials. |
| `tunnel setup` | Requires `--zone`; reads the token from `--token-file` or a prompt, never from an argument (`--token` on the command line is always refused). Optional `--origin <url>`, `--apex`. |
| `tunnel logs` | `-n, --lines <count>` (default 50). |
| `backup` | `-o, --output <file>`, `--no-database`. Copies the panel database with `VACUUM INTO` (needs `sqlite3`) unless `--no-database`; the archive holds credentials and is written 0600. |
| `restore <file>` | `-f, --force`; refuses while the gateway runs without it, and always keeps a safety copy of what it replaces. |
| `repair` | `--dry-run`; never deletes data, never touches a volume. |
| `migrate hostnames` | Previews the generated URL migration. `--apply` requires the panel to be stopped, saves a private backup and migrates stored routes and access decisions without starting applications. See [Update Portta](../guides/update.md). |


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
Every schema is at version 1; a bump is recorded in the changelog.

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
| `envs hostname` | `label`, `hostname` (null without `--domain`) |
| `projects list` | `projects[]` (`ProjectSummary` of the API) |
| `projects show` | the API's `Project` |
| `projects resolve` | `resolved`, `path`, `basis` (`root`, `subdirectory`, `worktree`), `project` (`id`, `slug`, `name`, `path`), `worktree` (`path`, `mainPath`); on failure `error` (`kind`, `message`, `hint`, `candidates[]`) with exit 1 (`unknown`, `ambiguous`) or 4 (`unauthorized`) |
| `projects resources` | the API's `ProjectResources` |
| `access list` | `bridges[]` (`id`, `project`, `service`, `target_port`, `local_port`, `kind`, `expires`, `bind`, `network`, `state`) |
| `service list` | `forwarders[]` |
| `web status` | `enabled`, `devMode`, `readOnly`, `expose`, `url`, `panel`, `socketProxy` |
| `network status` | `instance`, `bindAddress`, `publicIp`, `bindings`, `publicBindings` |
| `public status` | `enabled`, `profile`, `domain`, `bindAddress` |
| `dns check` | `domain`, `hostname`, `addresses`, `resolves` |
| `dns status` | `enabled`, `zone`, `domain`, `tokenSet` |
| `share list` | `shares[]` |
| `db status` | The panel database's state |
| `db migrate` | `applied[]`, `migrations[]` |
| `tls status` | `enabled`, `mode`, `domain`, `certificate`, `authority`, `acme` |
| `tunnel status` | `state`, `detail`, `hint`, `zone`, `wildcard`, `tunnel`, `connector`, `credential` |
| `tunnel setup` | `zone`, `tunnel`, `origin`, `routes[]`, `dns` (`type`, `name`, `target`, `proxied`) |
| `tunnel test` | `host`, `code`, `ok`, `detail`, `hint` |
| `backup` | `file`, `size`, `paths[]`, `database` |
| `repair --dry-run` | `dryRun`, `changes[]` |
| `migrate hostnames` | `applied`, `changed`, `moves[]`, `files[]`, `backup` |
| `agent context` | `host` (`portta`, `version`, `profile`, `gateway`, `domain`), `project` (`root`, `worktree`, `scope`, `compose`, `publishedPorts`, `exposure[]`, `urls`, `violations`, `note`), `skills`, `next` |
| `agents install\|status\|uninstall` | `home`, `dryRun`, `agents[]`, `items[]` (`agent`, `kind`, `path`, `state`, `action`), `notes[]` |

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

The source is Markdown shared with `/docs` and the documentation API. See [Use the Portta API](../guides/use-api.md).
