# 0030. The panel may operate a project, without owning it

**Status:** Accepted; see [0001](0001-decoupled-infrastructure.md)

## Context

[ADR 0001](0001-decoupled-infrastructure.md) forbids the gateway from owning a
consumer project. That sentence is the right *ownership* claim: Portta does not
move projects, mount their directories into the gateway, own their volumes, or
run `docker system prune`.

Operating is a different claim. The panel starts, stops, restarts and removes
one container at a time ([ADR 0008](0008-web-panel-socket-proxy.md)), with
`assertNotGatewayOwned` refusing Portta's own components and `removeContainer`
hard-coding `v=0`. Three features that follow from a remote development host —
turning a whole project off, rebuilding it, removing it from this host —
cannot be built against a reading of ADR 0001 that
forbids operating, and cannot be built by widening the socket proxy either.
[ADR 0026](0026-applying-settings-from-the-panel.md) rejects that: resolving
overlays against `.env` is reimplementing Compose inside the panel.

This record draws the line between owning and operating, and names one
mechanism for the operations Compose itself must perform.

## Decision

**Portta does not own a project. It may operate one, on request.**

| | Portta may | Portta may not |
|---|---|---|
| **Runtime state** | start, stop, restart containers it can see | — |
| **Composition** | rebuild and recreate on the operator's explicit request | change a project's Compose files |
| **Data** | — | remove a volume unless the operator names the project to confirm |
| **Anything remote** | — | ever, under any operation |

The load-bearing sentence kept from ADR 0001 is the ownership one. Acquiring
the ability to operate containers on request is a different claim, and the one
the panel makes per container.

### One runner, opt-in, with a fixed command

`portta up` prepares a second container, stopped, when `PORTTA_RUNNER=true`.
It follows ADR 0026 exactly:

- runs on the host, with the Docker socket, the Portta root, and the host
  filesystem mounted at `/host`, labelled `portta.managed=true` and
  `portta.component=runner`;
- accepts a **verb from a closed set**, never a command line — `up`, `stop`,
  `restart`, `build`, `down`, `down-volumes` — plus a project name;
- is gated behind `PORTTA_RUNNER`, which is absent from the panel's field
  catalogue, the way `PORTTA_APPLY` is;
- reports outcome by having the panel read the container back (state, exit
  code, log tail since `StartedAt`).

On a public host (`PORTTA_PROFILE=remote-public`) the runner is refused unless
`PORTTA_RUNNER_PUBLIC=true` **and** the panel is on its own domain
(`PORTTA_WEB_EXPOSE=domain`) with sign-in required (`PORTTA_AUTH_MODE=required`)
over TLS (`TLS_ENABLED=true`). `PORTTA_WEB_EXPOSE=public` stays refused because it
has no TLS. The switch is not a panel setting, so a panel cannot release itself,
and the refusal is checked on every read, including for a runner that already
exists.

The runner adds nothing to the panel's Docker permissions: it is started with
the `start` the panel already holds. Adding a verb to the set is an ADR-level
change, not a patch.

The request the runner reads is `{ verb, project, flags? }` in
`state/runner/request.json`. Flags are a closed set too: `no-cache` is valid
only with `build`. Adding a
flag is the same class of change as adding a verb. The working directory and
Compose files come from Docker's own labels
(`com.docker.compose.project.working_dir`, `.config_files`), never from a
path the panel supplied. The runner translates those host paths through
`/host` so it can read the files; `--project-directory` stays the host path,
because Compose hands bind mounts to the daemon.

### Where a project lives

Labels are the primary source: they are the project's own truth and need no
registration. A project whose working-directory label is missing is **not
operable**, shown with a reason. Project records do not override the path in
this decision; an override would be a path the operator typed, and that is a
later change.

### A remembered Environment

A remembered Environment remains in the panel after its containers have been
removed. The snapshot records `config_files` beside `working_dir` in
`environments`, and a remembered Environment is a full `Environment` with no
services and `presence: remembered`. Start on one hands the runner
`{ verb: "up", project, workingDir, configFiles }`. The panel validates both
paths against a bound (absolute, no
`..`, not `/`, not a top-level directory) and refuses a comma, a quote or a
backslash, which is what lets the shell read the list as text. The runner
uses those fields **only** when `docker ps` finds no container for the
project; with one, labels win, and any verb but `up` with no container still
dies. Portta's own project is refused by name, from `PORTTA_PROJECT_NAME` in
`.env`, and by directory, `PORTTA_ROOT`. Without the runner, the answer is a
409 whose hint is the exact `docker compose … up -d` to run on the host.
Forgetting a remembered Environment drops its row; a live one is refused.

### Host paths under the runner, so `include:` resolves

The runner links the first missing ancestor of the working directory, and of
every Compose file outside it, to its `/host` counterpart, and hands Compose
the host paths with `--project-directory` unchanged. An ancestor that exists in
the image and is not that link is an error, stated, never a silent misread. The
repository root is already mounted at its own path and needs no link.

### The safety envelope

- A verb that destroys data (`down-volumes`) requires the
  **project name typed back**, checked on the server.
- Portta's own components are refused by name, reusing `assertNotGatewayOwned`.
- No operation ever touches a Git remote, a forge repository or a
  branch.
- Every operation is logged where the operator can read it back.
- The working directory is validated as an existing directory and never
  concatenated into a shell string.

What ADR 0001 forbids, unchanged: moving or cloning projects, mounting
project directories into the **gateway**, owning volumes, and any `docker *
prune`.

## Consequences

Four features share one mechanism and one place to audit. A host that never
sets `PORTTA_RUNNER` has zero new attack surface; the panel renders that
absence with a reason, as `whyUnavailable` does for the applier.

The runner is the largest privilege in the system: a root container with the
Docker socket and a view of the host filesystem. The closed verb set, the
opt-in key, and the project name validated against the live snapshot are what
keep it bounded. A project started outside Compose has no working-directory
label and is reported as not operable rather than offered a dead button.
