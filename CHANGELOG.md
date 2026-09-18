# Changelog

All notable changes to Portta are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-09-18

### Added

- The gateway: Traefik in front of every Docker Compose project on one host.
  Each service is routed by hostname, `<project>-<service>` under `.localhost`
  or a custom domain, with private TCP routing for databases, local TLS from a
  generated CA (`portta tls`), Cloudflare tunnels (`portta tunnel`) and
  deliberate public exposure (`portta public`, `portta dns`). The profile is
  `local`, `remote-private` or `remote-public`; the Compose overlays under
  `docker/compose/profiles` are derived from it, the TLS mode and the ACME
  challenge.
- The `portta` CLI, published as `@codions/portta` for Node 24 or newer and
  Docker Engine 24 with Compose v2. `npm install -g @codions/portta` or
  `npx @codions/portta setup` installs it; `portta setup` installs the runtime
  into `~/portta` unless `--dir` says otherwise, prints where it installed, and
  the CLI finds that directory from anywhere (`PORTTA_HOME`, `~/portta`,
  `/opt/portta`, `~/.portta`, `/var/lib/portta`, in that order). Every command
  is in the [CLI reference](docs/product/reference/cli.md); all of them accept
  `--json` for agents, `--quiet` and `--verbose`.
- The panel (`portta web up`): one Next.js and Hono process with Overview,
  Projects, Services, Docker, Network, Access, Gateway and Settings, live
  updates fed by Docker events, a container console over Docker exec
  ([ADR 0043](docs/development/adr/0043-container-console-over-docker-exec.md)),
  a command menu (`⌘K`), light and dark themes, English and Brazilian
  Portuguese, and the bundled documentation served at `/docs`.
- Panel persistence in one SQLite file, `state/panel/portta.db`, opened in
  process and migrated at start under a lock; no database server.
  `portta db status|migrate|shell|dump|restore` operate on that file
  ([ADR 0037](docs/development/adr/0037-sqlite-is-the-panel-database.md)).
- Authentication that is optional inside a trusted network: no sign-in on
  loopback, Tailscale or a VPN unless `panel.auth` is `required`; always
  required on a LAN or under public exposure. Owner, admin, developer and
  viewer roles, per-Project access, personal API tokens (`portta auth token`),
  two-factor sign-in, and ForwardAuth protection for project hostnames and
  shares (`portta protect`)
  ([ADR 0051](docs/development/adr/0051-authentication-is-optional-inside-a-trusted-network.md)).
- Projects and issues: a Project groups repositories and environments, and its
  work lives in GitHub Issues or Linear, read live through the host daemon
  (the `gh` session or `LINEAR_API_KEY`); only the issue reference
  (`github:org/repo#12`, `linear:ENG-42`) is stored. `portta issues` lists,
  shows, creates, edits, closes, reopens and comments on issues;
  `portta sessions`, `portta activity` and `portta projects context` record
  and describe the work around them
  ([ADR 0050](docs/development/adr/0050-work-lives-in-an-external-provider.md),
  [ADR 0018](docs/development/adr/0018-github-issues-through-the-gh-cli.md)).
- The `.portta` directory as the project contract: `.portta/project.yaml`
  declares the project's name, main branch, worktree root, branch pattern,
  stack and instruction files, and refuses anything that names a host (a URL,
  an absolute path, a published port); `.portta/compose.portta.yaml` carries
  the Compose overlay. `portta envs analyze --json` reports the resolved
  document or its validation errors. See
  [The `.portta` directory](docs/product/reference/portta-directory.md) and
  [ADR 0052](docs/development/adr/0052-the-portta-directory-is-the-project-contract.md).
- The host daemon, `portta host serve` (`--detach` for the background) and the
  `portta-host` user service (`portta host service install|uninstall|restart|status|logs`):
  a token-protected process on the host that answers issue requests and serves
  the modules needing git, tmux or agent CLIs; the panel reaches it through an
  authorised proxy
  ([ADR 0047](docs/development/adr/0047-host-daemon-and-panel-proxy.md)). See
  [Run the host daemon](docs/product/guides/host-daemon.md).
- Taskflow, an official module that ships with Portta and is always on. Git
  worktrees with a full lifecycle (`add`, `open`, `close`, `archive`, `label`,
  `profile`, `merge`, `remove`, `prune`, `restore`), persistent tmux or herdr
  sessions with profiles and panes, and a browser terminal bridged by the
  panel. Direct Sessions and durable Workflow Runs with journals, transcripts,
  cancellation, resume, idempotency keys and workspace policies
  (`current_branch`, `new_branch`, `isolated_worktree`), on a deterministic
  workflow engine with a sandboxed JavaScript DSL and six built-in workflows.
  Host, Docker profile, Compose, Dockerfile and Dev Container environments per
  worktree, with detection, trust review, resource limits, a service catalog
  and private loopback endpoints. Claude Code and Codex with native chat,
  OpenCode and Pi as workflow providers, pull-request context through `gh`,
  and Linear issues, label automation and conversation posting. One host
  daemon per machine serves every Project under `/api/modules/taskflow`,
  protected by `state/host/token`, and the panel authorises each forwarded
  route against a Portta permission. `portta flow` operates it from a
  terminal, the panel shows its pages, and `portta doctor` and `portta mcp`
  gain its checks and tools. Removing a worktree is refused while it holds
  uncommitted changes or commits that exist nowhere else, unless `--force`;
  `prune` keeps and reports such a worktree. Every worktree is created with
  relative Git links, so Git works inside a Dev Container opened on it. See
  [Taskflow](docs/modules/taskflow/README.md).
- An ACP provider registry: the four adapters Taskflow launches over the
  Agent Client Protocol (`codex`, `claude-code`, `opencode`, `pi`) are the
  defaults of a registry, and `providers:` in `.portta/taskflow.yaml` (or the
  local overlay) adds any other harness that speaks the protocol or replaces a
  builtin's command, without a code change. A Run on the ACP transport refuses
  an unknown provider before it starts, naming the available ones, and
  `portta flow workflows doctor` lists every provider with the resolved adapter
  path ([configuration](docs/modules/taskflow/configuration.md#acp-providers)).
- Module endpoints through Traefik: the panel writes one
  `portta-module-<id>.yaml` per registered module, derived from the module
  manifest; a module never writes Traefik configuration itself
  ([ADR 0048](docs/development/adr/0048-module-endpoints-through-traefik.md)).
- An MCP server, `portta mcp`, exposing the panel's verbs and the documentation
  to agents ([MCP reference](docs/product/reference/mcp.md)).
- The same tools over HTTP, for an agent with no CLI where it runs: with
  `PORTTA_MCP_HTTP=true` the panel serves a stateless Streamable HTTP MCP
  endpoint at `POST /api/mcp`, authenticated with a personal API token and
  under the same agent ceiling as stdio. The tool registrations live in one
  workspace, `portta-mcp`, so a tool exists on both transports or on neither;
  `resolve_project` stays stdio-only because it reads the host
  ([MCP reference](docs/product/reference/mcp.md#reach-it-over-http),
  [ADR 0054](docs/development/adr/0054-mcp-tools-are-shared-and-served-over-http.md)).
- `portta projects resolve --path <abs>` and the MCP tool `resolve_project`:
  which Project a directory belongs to, resolved from the registered root, a
  subdirectory of it, a linked worktree, or, declared as inferred, a clone with
  the same remote. It reads the host and the panel and writes nothing, and it
  fails with a named reason (`unknown`, `ambiguous` with the candidates,
  `stale`, `unauthorized`) instead of guessing.
- A versioned contract on every `--json` output: an envelope with `schema`
  (the command path, such as `envs.list`) and `version` (an integer that moves
  only on an incompatible change) around `data`, so a script or an agent can
  tell what it received before reading it
  ([CLI reference](docs/product/reference/cli.md#json-shapes)).
- A Development Context an outside tool can depend on: the body of
  `GET /api/projects/:slug/context`, `portta projects context --json` and the
  MCP tool `get_context` names its own `schema` (`development-context`) and
  `version`, lists each repository's worktrees from the Taskflow daemon with
  the Environment that runs one, says which base ref `ahead`/`behind` are
  measured against, and carries `diagnostics` for what needs doing first: a
  repository without a path, a missing or stale scan, a stopped Environment,
  a daemon that did not answer
  ([MCP reference](docs/product/reference/mcp.md#the-development-context)).
- Specification discovery, read-only: the host scan references the decision
  records (`docs/**/adr/*.md` and equivalents) and the OpenSpec and Spec Kit
  documents a repository keeps, by path, convention, kind, title and hash,
  never by content. Served by `GET /api/repositories/:id/specifications`,
  `portta repos specs`, the MCP tool `list_specifications` and per repository
  in the Development Context. A repository with none is the normal case, and
  a `specs/` tree is attributed to Spec Kit only beside its `.specify/` marker
  ([ADR 0053](docs/development/adr/0053-portta-is-spec-aware-not-spec-owned.md)).
- Seven agent skills, `portta-method`, `portta-commit`, `portta-pull-request`,
  `portta-issue`, `portta-resolve-issue`, `portta-workflows` and
  `portta-adopt-compose`, each following
  the [Agent Skills specification](https://agentskills.io/specification) and
  installable with the [Skills CLI](https://www.skills.sh):
  `npx skills add codions-labs/portta -g`. They state how work happens in a
  Portta project, and that no commit, pull request or issue credits an agent.
  See [the working agreement](docs/product/concepts/working-agreement.md).
- Remote hosts over SSH (`portta remote`), short-lived loopback bridges to a
  project's services (`portta access`, `portta db open`, `portta redis open`),
  private forwarders (`portta service publish`), temporary shares
  (`portta share`), and backups of what an installation cannot regenerate
  (`portta backup`, `portta restore`).
- Guides for local name resolution, `*.localhost` on macOS and Linux
  ([Develop applications locally](docs/product/guides/local-development.md)),
  and for a custom local domain such as `*.portta.test`
  ([Use a custom local domain](docs/product/guides/local-domains.md)).
- Publication: npm dist-tags `latest` (a GitHub Release), `next` (`main`) and
  `dev` (`develop`); the panel image on GHCR, tagged with the exact version the
  installed runtime pulls on every channel; and the
  `ghcr.io/codions-labs/portta-sandbox` image with Codex, Claude Code, OpenCode
  and Pi for Taskflow's Docker profiles
  ([Publish the Portta CLI](docs/development/publish-cli.md)).
- The published package is 2.6 MB unpacked, with a 447 KB `dist/cli.js`: the
  build minifies while keeping function names for stack traces, splits the
  shared graph into chunks so the host daemon ships once instead of twice,
  imports Zod by name so tree shaking drops its locales and its v3
  compatibility tree, loads `systeminformation` on demand, and ships the
  documentation corpus gzipped.
- The package carries the project README, the MIT licence text and its
  keywords, so the npm page documents the CLI it installs. The build generates
  all three from the repository root, rewriting the README's relative links to
  absolute GitHub URLs.

[Unreleased]: https://github.com/codions-labs/portta/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/codions-labs/portta/releases/tag/v0.1.0
