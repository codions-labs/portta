---
name: portta-host-context
description: Explains how to work on a server running Portta. Use at the start of any session on a shared development host, when a project needs a URL, when a port seems taken, when starting or exposing containers, or when deciding whether a project needs Portta at all.
license: MIT
compatibility: Requires the portta CLI on the host. Works read-only without a running panel.
metadata:
  author: codions-labs
  version: "1"
---

# Work on a Portta host

A Portta host runs many Docker projects side by side, for many people and many
agents. A gateway routes each web service at `<project>-<service>.<domain>`, so
no project publishes a host port and none needs to. Other environments are
running right now, and you cannot see who owns them.

This skill tells you where you are, what applies, and what you may do alone.

## 1. Read the preflight

At the start of a session run:

```
portta agent context
```

Skip it only when its output is already in your context, as it is when a
session hook ran it. The command is read-only, offline, finishes in under a
second and always succeeds. For a machine-readable answer add `--json`: the
envelope is `{ "schema": "agent.context", "version": 1, "data": ... }`.

If `portta` is not installed, or the command prints nothing, this is not a
Portta host. None of this applies. Do not install anything to make it apply.

`data.project.scope` decides what you do:

| `scope` | Meaning | What you do |
|---|---|---|
| `no-portta` | The CLI exists, the host has no installation | Nothing. Work normally |
| `excluded` | The person listed this directory in `~/.config/portta/agents/scope.yaml` | Nothing. Do not suggest Portta here |
| `out-of-scope` | Home directory, a folder without Git or Compose, or nothing that serves HTTP | Nothing. If you start containers, publish no ports |
| `needs-adoption` | A Compose file and no Runtime Plan | Use the `portta-adopt-compose` skill |
| `needs-dockerizing` | A Dockerfile or a web service, and no Compose file | Use the `portta-dockerize` skill. It writes nothing before the person approves |
| `compliant` | A Runtime Plan, no violations | `portta runtime up`, then report the URLs |
| `non-compliant` | A Runtime Plan with a published port, a stale plan, or (public host) a service nobody decided about | Read `data.project.violations`, then use `portta-adopt-compose` |

When the scope is unclear the answer is `out-of-scope` with a `note`. Believe
it. Never adopt a project the preflight did not point at.

A Git worktree (`data.project.worktree: true`) must have its own namespace so
it gets its own URL and its own volumes:

```
portta envs namespace
```

Put the result in the worktree's `.env` as `COMPOSE_PROJECT_NAME`.

## 2. What you may do

| Do alone | Ask first | Never |
|---|---|---|
| The preflight, `portta envs analyze`, any `--dry-run` | Any decision that is `pending`, including whether to protect a service or leave it public | `docker * prune`, or stopping a container of another project |
| `portta adopt` when nothing is pending | Creating or editing a Compose file or a Dockerfile | Publishing a port, a database included |
| `portta runtime up` in your own namespace | Replacing an environment that already runs with data: a different namespace means new volumes | Taking the gateway down, or changing the exposure profile |
| Reporting `portta urls` | Removing protection, creating a temporary link, committing and pushing | Reusing another environment's volume or namespace |

When a row says ask, state the question in the project's terms, name the
option, and wait for the answer. Do not choose for the person.

## 3. The rules of a shared host

Never:

- stop or remove a container, volume or network you did not create. A
  container holding port 5432 is somebody's working environment.
- run `docker system prune`, `docker volume prune`, `docker network prune` or
  any other `docker * prune`. They delete other people's data.
- publish a host port. Not a web port, and above all not a database or a cache:
  no `5432:5432`, not on `0.0.0.0`, not even temporarily.
- change an internal port to get around a conflict. A port that looks taken
  means something publishes a port it does not need. Remove that `ports:`
  entry, which fixes it for everyone.
- reuse another environment's volume, network or namespace. Two environments
  writing to one database corrupt each other silently.
- take the gateway down to fix your own project. It serves every environment.
- run `rm -rf` against another checkout. Removing a project from the host never
  deletes its code.

Always:

- check ownership before you touch a container:
  `docker inspect <container> --format '{{ index .Config.Labels "com.docker.compose.project" }}'`.
  If the answer is not your namespace, it is not yours.
- run `portta doctor` before improvising infrastructure. It changes nothing and
  names a fix for each problem.
- stop only what you started, from its own directory: `portta runtime down <path>`.

## 4. Reach a database without publishing it

In this order, and stop at the first that works:

1. `docker compose exec <service> ...` inside the project.
2. `portta db psql --project <name> --service postgres`, or `portta redis cli`.
   A client runs inside the project's network: nothing is published and nothing
   is left behind.
3. `portta access open --project <name> --service postgres`, only when a person
   needs a GUI. It binds loopback. Close it with `portta access close --project <name>`.

## 5. Report URLs

After you start an environment:

```
portta urls --project <name>
```

Report those hostnames, never `localhost:3000`, which means nothing on a shared
host. A service can answer on several: the hostname the project derives, and
addresses the user added in the panel, including a domain they own and pointed
at the server. The line marked `primary` is the one to report first, and a
`custom` one is the address the user will open and share. The derived hostname
keeps answering beside it. Do not add or remove these addresses yourself: they
are configured in the panel. On a public host a service may answer only after a login. Say which
services are protected and which are open, using `data.project.exposure` from
the preflight, and never print or store a password. Temporary share links are
created in the panel, not by you.

## 6. When a route does not work

```
portta urls          # is the hostname listed?
portta doctor        # collisions, labels, exposure
```

The usual causes: a wrong backend port, the service missing from the gateway
network, a Traefik service name that collides with another project's, or labels
written in map form so `${COMPOSE_PROJECT_NAME}` was never interpolated. The
fix is in the project, or in `portta adopt`, never in the gateway.

## Skill and CLI

The CLI enforces what matters; this skill orders it. Installing the whole layer
on a machine, instruction and hook included, is `portta agents install`.
The full rules are in the
[agent guidelines](https://github.com/codions-labs/portta/blob/main/docs/agent-guidelines.md).
