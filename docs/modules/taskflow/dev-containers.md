# Dev Containers

Taskflow treats the Dev Container Specification as one of several optional environment providers, alongside Docker Compose and a plain Dockerfile. Host is the baseline when no container configuration exists, or when a profile explicitly requests it.

## Selecting a provider

Environment selection is profile-scoped:

```yaml
profiles:
  default:
    runtime: host
    environment:
      provider: auto # auto | host | docker | compose | devcontainer
      config: .devcontainer/devcontainer.json
```

With `provider: auto`, Taskflow picks the first environment it can resolve, in this order:

1. **Dev Container** — a single detected `.devcontainer/devcontainer.json` (or an explicit `environment.config` when the repository has more than one).
2. **Compose** — a `compose.yaml`/`docker-compose.yaml` at the repository root.
3. **Dockerfile** — a root `Dockerfile`.
4. **Host** — the baseline, used when nothing else matches.

An explicit `provider: host` always keeps the host baseline, even when the repository contains container metadata. `provider: docker` selects an explicitly configured Docker profile runtime rather than an environment inferred from a repository file — see [Configuration](configuration.md) and [Integrations](integrations.md#docker-runtime-profiles) for that path.

The official `devcontainer` CLI owns configuration parsing, image builds, Compose reuse, startup, Features, users, and lifecycle hooks. Taskflow only calls its `read-configuration`, `up`, and `exec` commands — it never duplicates those rules or creates the Dev Container's Compose stack itself. See [Environment providers](architecture.md#environment-providers) for how this fits into the rest of the system.

## Compose and Dockerfile providers

`compose` starts an isolated stack per worktree with a deterministic `docker compose --project-name taskflow-<environment-id>`, keeping the agent on the host. Taskflow never modifies the repository's `compose.yaml` or Dev Container files.

`dockerfile` is a single-container provider. It builds the worktree's `Dockerfile`, names and labels the container from its environment ID, mounts the worktree at `/workspace`, and does not publish host ports. Service discovery reads the image/container `EXPOSE` metadata; local forwarding reaches those ports without changing the Dockerfile.

## Requirements

The Dev Container provider requires the [Dev Containers CLI](https://github.com/devcontainers/cli) at exactly **version 0.89.0**. Taskflow rejects any other installed version with an actionable diagnostic — install that version with `npm install -g @devcontainers/cli@0.89.0` (or your preferred package manager) before using it. Compose and Dockerfile providers only require a working Docker Engine and, for Compose, the `docker compose` plugin.

Compatibility across Dev Container tools (VS Code, Codespaces, Coder, DevPod, Podman) is not assumed; VS Code is the primary cross-tool target Taskflow validates against.

## Git inside a linked worktree

A worktree is held together by two files: `<worktree>/.git`, which points forward at the worktree's Git directory, and `<common>/worktrees/<id>/gitdir`, which points back at that checkout. Taskflow creates every worktree — for a branch and for a Workflow Run — with `git worktree add --relative-paths`, so both links are relative and still resolve inside a container. Before starting a Dev Container on a worktree, Taskflow asks Git itself for the worktree and common directories (`git rev-parse --git-dir --git-common-dir`), passes `--mount-git-worktree-common-dir` to the CLI, and bind-mounts the common directory where that relative forward link lands. Inside the container, `git status`, `git diff`, `git commit` and `git rev-parse --git-common-dir` work and point at the right repository.

Both links matter. A forward link that is an absolute host path makes Git in the container fail with `fatal: not a git repository`. An absolute back link fails more quietly: Git reports the worktree as prunable, and `git worktree prune` — which `git gc` runs on its own — deletes the worktree's administrative directory and leaves the checkout unusable.

A worktree Taskflow owns — Taskflow runtime metadata in its Git directory, or the recorded creation base of a Workflow Run — whose links are absolute has those two files rewritten on its next start, atomically, and verifies with `git rev-parse` that the worktree still resolves to the same repository before a container uses it; if it does not, the change is reverted and the start fails. Taskflow rewrites only the worktree being started. `git worktree repair --relative-paths` is not used for this, because it sweeps every linked worktree in the repository and would rewrite the links of worktrees Taskflow does not own. A worktree Taskflow did not create is never touched: the start fails with a diagnostic naming the command its owner can run.

The start also fails, rather than opening a container whose Git points nowhere, when the Dev Container configuration sets a custom `workspaceMount`. The Dev Containers CLI then ignores `--mount-git-worktree-common-dir` ([devcontainers/cli#1243](https://github.com/devcontainers/cli/issues/1243)) and the common directory cannot be mounted; remove `workspaceMount`, or use that configuration from the main checkout.

## Trust, isolation, and resource limits

Every new or changed Dev Container or Compose configuration requires explicit trust before Taskflow materializes it. The preflight check records `initializeCommand`, Features and lockfile drift, privileged mode, Linux capabilities, security options, devices, broad host mounts, the Docker socket, secret-shaped environment keys, and Compose isolation risks. Values that could contain secrets are never persisted — only discovery-safe fields and redacted security evidence are kept.

A Dev Container or Compose stack is not a security sandbox for untrusted code. A repository that needs strong isolation should run Docker itself inside a disposable VM or dedicated sandbox.

Taskflow applies a visible resource ceiling to every container it owns: 4 CPUs, an 8 GiB memory/swap limit, and 1024 PIDs. A project may have at most eight non-host environments running at once; the ninth request fails before startup. The Docker socket is never added by Taskflow, and public exposure is never automatic — see [Services and access](#services-and-access).

## Lifecycle

Opening or creating a worktree session starts its selected environment automatically once trusted. Discovering an existing worktree only records the environment as `detected`, without starting anything; use `portta flow environment <branch> start` to bring it up.

- `start` — resolve the provider, verify trust and concurrency, bring the environment up, apply the resource policy, and persist its IDs and config hash.
- `stop` — stop only the containers Taskflow created for that environment.
- `resume` — verify ownership and start those exact containers again.
- `restart` — revoke active endpoints, stop, resume, and restore exposure.
- `rebuild` — re-resolve the configuration, require new trust on hash drift, and rebuild with a fresh container.
- `destroy` — revoke access and remove the environment's containers and Compose-labelled networks; safe to repeat.
- `reconcile` — runs continuously: resumes desired-but-stopped resources, stops undesired-but-running ones, retries interrupted destruction, and marks resources missing rather than guessing or recreating by name.

If a worktree's checked-out branch predates the Dev Container, Compose, or Dockerfile manifest it needs, the environment is shown as `failed` with a diagnostic instead of being hidden.

## Services and access

The service catalog combines explicit Taskflow host-service configuration, Dev Container hints, Compose labels, and Docker inspection (including a Dockerfile's `EXPOSE` metadata). Confidence and provenance are preserved, and `unknown` is used rather than guessing.

Container ports are never published as Docker host ports. Instead, `exposure.local.autoExpose` controls how Taskflow creates private endpoints for discovered services:

| Value | Behavior |
| --- | --- |
| `all` (default) | Every discovered service gets a private loopback endpoint as soon as its environment is ready. |
| `http` | Only HTTP(S) services are exposed automatically. |
| `manual` | Nothing is exposed automatically; use **Expose** in the dashboard or `portta flow environment <branch> expose <service>`. |

HTTP/SSE/WebSocket, TCP, and UDP endpoints all use dynamic loopback forwards (`http://127.0.0.1:<port>` for HTTP). Taskflow does not bind port 80 or route by `Host` header; a named URL in front of an HTTP forward is the job of an endpoint exposure provider, and the host daemon configures none yet. Setting `exposure.local.provider: disabled` turns off Taskflow-created endpoints entirely, independent of `autoExpose`.

The local TCP/UDP forwarder runs a small Node.js bridge inside the primary environment, so exposing non-HTTP services requires `node` there; environments without it still support execution and discovery, but their services stay internal-only.

## CLI reference

Every environment action is a `portta flow environment <branch> …` command, and each also accepts `--run <run-id>` to target a Run's environment instead of a worktree branch. See [Environments and services](cli.md#environments-and-services) in the CLI reference for the command list and its options.

## Testing locally

A live fixture at `tests/fixtures/taskflow/devcontainer-environment` exercises the Dev Container provider end to end against a real Compose stack (backend, frontend, and PostgreSQL). It requires Docker and is opt-in:

```bash
PORTTA_FLOW_LIVE_DOCKER=1 npm exec --workspace portta-host -- vitest run \
  src/modules/taskflow/__tests__/devcontainer-environment.live.test.ts \
  --testTimeout=300000 --hookTimeout=300000
```
