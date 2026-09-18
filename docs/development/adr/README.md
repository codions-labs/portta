# Architecture decision records

Short records of decisions that are expensive to reverse. Each states the
context, the decision, and what it costs us. Numbers are stable identifiers,
and a gap in the sequence means a record was withdrawn before the first
release.

| # | Decision | Status |
|---|---|---|
| [0001](0001-decoupled-infrastructure.md) | The gateway is infrastructure, not a parent project | Accepted; see 0030, 0047 |
| [0002](0002-docker-socket-proxy.md) | Traefik reaches Docker through a filtered read-only proxy | Accepted |
| [0003](0003-traefik-static-config-via-env.md) | Traefik static configuration lives in environment variables | Accepted |
| [0004](0004-pinned-versions.md) | Every component image pins an explicit version | Accepted |
| [0005](0005-hostname-convention.md) | Hostnames are derived from the labels Compose already injects | Accepted; see 0023 |
| [0006](0006-compose-project-name-as-namespace.md) | `COMPOSE_PROJECT_NAME` is the namespace for parallel environments | Accepted |
| [0007](0007-tailscale-sidecar.md) | Traefik runs inside the Tailscale container's network namespace | Accepted |
| [0008](0008-web-panel-socket-proxy.md) | The web panel gets its own Docker socket proxy | Accepted; see 0043 |
| [0009](0009-tcp-routing-by-hostname.md) | Databases are told apart by hostname, with TLS terminated at the gateway | Accepted |
| [0010](0010-git-collected-on-the-host.md) | Git is collected on the host, and the panel only reads the result | Accepted; see 0018, 0032 |
| [0011](0011-bounded-traefik-write-surface.md) | The panel has a bounded Traefik write surface | Accepted; see 0048 |
| [0012](0012-routed-panel-access-requires-authentication.md) | Routed panel access requires authentication | Accepted; see 0035, 0051 |
| [0013](0013-what-the-panel-persists.md) | The panel persists decisions, not runtime observations | Accepted; see 0037, 0049, 0050 |
| [0014](0014-monorepo-and-the-typescript-cli.md) | The repository is an npm workspace with one TypeScript CLI | Accepted |
| [0015](0015-node-is-required-on-the-host.md) | Node 24 is required on the host | Accepted |
| [0016](0016-state-that-could-be-shared.md) | State that could be shared, and what must never be | Accepted |
| [0017](0017-no-docker-sdk.md) | The panel speaks the Docker Engine API directly | Accepted |
| [0018](0018-github-issues-through-the-gh-cli.md) | GitHub Issues go through the `gh` CLI on the host | Accepted; see 0047, 0050 |
| [0019](0019-compose-files-live-under-docker.md) | The compose files live under `docker/compose/`, one directory per axis | Accepted; see 0044 |
| [0020](0020-installer-and-portta-home.md) | An installation is one runtime directory | Accepted |
| [0021](0021-panel-access-modes.md) | Panel access is an explicit decision | Accepted; see 0027, 0035, 0051 |
| [0022](0022-project-domain-modes.md) | The base domain is a mode, and a host with no domain gets one from its address | Accepted |
| [0023](0023-flat-hostname-labels.md) | A service's whole name lives in one DNS label | Accepted; see 0005 |
| [0024](0024-capabilities-providers-endpoints.md) | A service has endpoints, not an access mode | Accepted |
| [0025](0025-cloudflare-tunnel.md) | One tunnel, one wildcard rule, and Traefik keeps routing | Accepted |
| [0026](0026-applying-settings-from-the-panel.md) | Applying panel settings uses one isolated applier | Accepted |
| [0027](0027-forward-authentication-service.md) | Protected application hosts use ForwardAuth | Accepted |
| [0028](0028-operational-images-live-under-docker.md) | Operational image contexts live under `docker/images/` | Accepted |
| [0029](0029-product-behavior-lives-in-typescript.md) | Product behavior lives in TypeScript | Accepted |
| [0030](0030-the-panel-and-a-project-lifecycle.md) | The panel may operate a project, without owning it | Accepted; see 0001, 0047 |
| [0031](0031-projects-home-and-project.md) | Projects, repositories and environments are distinct | Accepted |
| [0032](0032-portta-development-model.md) | The Portta development model | Accepted; see 0010, 0013, 0031, 0038, 0050 |
| [0034](0034-child-process-output.md) | A child process is never silent for long | Accepted |
| [0035](0035-authentication-lives-in-the-panel.md) | The panel authenticates its own requests | Accepted; see 0051 |
| [0036](0036-next-app-router-and-the-custom-server.md) | The panel is a Next application on a server of its own | Accepted |
| [0037](0037-sqlite-is-the-panel-database.md) | The panel's database is SQLite, through Drizzle | Accepted; see 0013, 0049 |
| [0038](0038-roles-and-project-access.md) | Four roles, and access by Project | Accepted; see 0035 |
| [0039](0039-personal-api-tokens.md) | A token belongs to a person, and never exceeds them | Accepted; see 0035 |
| [0040](0040-installation-environment-contract.md) | The installation environment is the configuration contract | Accepted; see 0037, 0051 |
| [0042](0042-portta-owned-ssh-keys.md) | Portta-owned SSH keys use a narrow panel boundary | Accepted |
| [0043](0043-container-console-over-docker-exec.md) | Container consoles use Docker exec through the panel proxy | Accepted; see 0008 |
| [0044](0044-example-projects-live-in-projects-home.md) | Example projects live in Projects Home | Accepted; see 0019, 0028 |
| [0046](0046-official-modules-are-composed-at-build-time.md) | Official modules are composed at build time | Accepted |
| [0047](0047-host-daemon-and-panel-proxy.md) | A host daemon does the host's work, and the panel reaches it through a proxy | Accepted; see 0001, 0030 |
| [0048](0048-module-endpoints-through-traefik.md) | A module exposes endpoints through Traefik, in one bounded file of its own | Accepted; see 0011 |
| [0049](0049-host-state-in-sqlite.md) | Host daemon state lives in SQLite under `PORTTA_HOME/state/host` | Accepted; see 0013, 0037 |
| [0050](0050-work-lives-in-an-external-provider.md) | Work lives in an external provider, and Portta points at it | Accepted; implemented for GitHub by 0018; see 0032 |
| [0051](0051-authentication-is-optional-inside-a-trusted-network.md) | Authentication is optional inside a network that already authenticates | Accepted; see 0012, 0021, 0035 |
| [0052](0052-the-portta-directory-is-the-project-contract.md) | The `.portta` directory is the project's contract, and it never describes a host | Accepted; see 0031, 0040 |
| [0053](0053-portta-is-spec-aware-not-spec-owned.md) | Portta is spec-aware, not spec-owned | Accepted; see 0050, 0052 |
| [0054](0054-mcp-tools-are-shared-and-served-over-http.md) | The MCP tools are shared, and the panel serves them over HTTP | Accepted; see 0018, 0035, 0046 |
