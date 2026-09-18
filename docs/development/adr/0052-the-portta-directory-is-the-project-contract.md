# 0052. The `.portta` directory is the project's contract, and it never describes a host

**Status:** Accepted; see [0031](0031-projects-home-and-project.md),
[0040](0040-installation-environment-contract.md)

## Context

The same project runs on a laptop, in a homelab and on a development VPS. What
it *is* does not change between them; where it is reachable does.

`.portta/` in a repository holds five things, and what belongs there needs
one rule:

| Path | Committed | Written by |
|---|---|---|
| `.portta/project.yaml` | optional | the project (identity and conventions) |
| `.portta/taskflow.yaml` | yes | the Taskflow module |
| `.portta/taskflow.local.yaml` | no | the machine |
| `.portta/workflows/` | yes | the project |
| `.portta/runtime.json` | optional | the project, read by `adopt` |
| `.portta/worktrees/` | no | Git |

`runtime.json` shows the rule. It carries Compose files, profiles, a mode and
per-service HTTP ports, and deliberately carries no gateway domain, no URL, no
network or label, and no concrete Compose namespace: those are resolved per
host. Stated for one file, the rule does not stop the next file from declaring
a domain, a published port or an absolute path — and a project that does
becomes unportable the first time it is cloned somewhere else.

The distinction is not a style preference. A domain, a certificate, a published
host port and a Projects Home are properties of the machine that runs the
project, and two machines running the same commit legitimately disagree about
all of them. A service's internal port, its Compose file and which service is
the HTTP surface are properties of the project, and two machines that disagree
about those are running different software.

## Decision

**`.portta/` describes what the project is and needs. It never describes where
the project is running.**

Committed, and therefore the project's: names, the main branch, the stack, the
Compose input set, which services have an HTTP surface and on which *internal*
port, the branch-name pattern, the worktree root as a path relative to the
repository, workflows, lifecycle hooks, and which instruction files an agent
should read.

Never committed, and therefore the host's: domains, subdomains, hostnames, IP
addresses, TLS material, published host ports, absolute paths, Projects Home,
tunnels, VPN membership, credentials, the concrete Compose namespace, and the
choice of multiplexer or environment provider. These live in `$PORTTA_HOME`,
in `.portta/*.local.yaml`, or are derived at runtime.

Every file under `.portta/` carries an explicit schema version, as
`runtime.json` already does with `schemaVersion`.

A machine-specific overlay is always a separate file ending in `.local.yaml`,
never a section inside a committed one, so the boundary survives a careless
edit.

## Consequences

A repository cloned onto another machine needs no edit to be prepared: `portta`
reads the project's own description and resolves everything host-shaped itself.
A project can be adopted by someone who does not use Portta at all, because
what is committed is a description, not a configuration of our gateway.

The cost is that a project cannot pin its own URL. A team that wants
`api.example.test` to be stable across machines has to configure that on each
host, or accept the derived name. We judge that acceptable: a project that
pins its URL has taken a decision for a machine it cannot see.

`project.yaml` (`packages/core/src/project-config.ts`) is the home for the
project-level group: name, main branch, worktree root, branch pattern, stack
and instruction files. It deliberately carries no services, ports, Compose
files or profiles, which describe how the runtime comes up and live in
`runtime.json`; `taskflow.yaml` keeps the module-level group (panes,
multiplexer, agent profiles). A host-shaped value in `project.yaml` is refused
rather than ignored, and no file may name a host.
