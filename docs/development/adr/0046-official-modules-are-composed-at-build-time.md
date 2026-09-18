# 0046. Official modules are composed at build time

**Status:** Accepted

## Context

Taskflow, a control plane for parallel development with agents, is part of
Portta. It is large — worktrees, terminals, agent runs, workflows — and most of
Portta has no reason to know about it. It must still share Portta's toolchain,
its permission vocabulary, its API conventions, its panel and its CLI.

Portta's extension points were fixed lists: the routers in `createApi`, the
WebSocket routes and jobs in `apps/web/server/main.ts`, the permission
statements, `ACTIVITY_KINDS`, the rail, the Settings sections, the translation
namespaces, the CLI commands, the MCP tools and the doctor checks. Each new
feature was a line in each list.

## Decision

**A module is a vertical slice of Portta that is compiled in and always on.**
There is no plugin loading at runtime, no third-party module, no workspace per
module and no per-installation switch.

- Its manifest is declared once with `defineModule` in `portta-core/modules`:
  an id, a name, the permission statements it adds with optional `developer`
  and `viewer` grants, the activity kinds it records, and its documentation
  directory. `MODULES` lists the manifests.
- Each layer keeps a static registry beside its code:
  `packages/server/src/modules`, `packages/host/src/modules`,
  `packages/cli/src/modules` and `apps/web/modules`. Those files are the only
  way code outside a module reaches it.
- Every list a module can extend is **the base list followed by the modules'**.
  A module never reorders or redefines a base entry; a duplicate permission
  resource, activity kind, translation namespace or out-of-prefix socket path is
  refused when the process loads.
- Routes answer under `/api/modules/<id>` and sockets under `/ws/modules/<id>/`.
  A registered module mounts its routes, registers its commands and shows its
  pages in every installation. Its permission statements and activity kinds
  are part of Portta's vocabulary, so a stored grant or event always names
  something the build knows.
- The registries are typed tuples, so an empty registry adds nothing to any
  union and the generated OpenAPI document, the docs corpus and every list are
  unchanged.

## Alternatives

- **Runtime plugins** loaded from `PORTTA_HOME`. They would make the permission
  vocabulary and the API contract depend on what is installed on one host,
  defeat the type-checked boundaries, and turn the installation directory into
  a code-execution path.
- **A package per module.** It would duplicate the build, test and publish
  tooling the monorepo already has, and invite a second set of conventions.
- **Feature flags scattered through the lists.** Nothing would say where a
  module starts or ends, and removing one would be an archaeology exercise.

## Consequences

- Adding or removing a module is a reviewed change to the registries, not an
  operator action.
- Whether a module is present is a build decision, not an operator setting:
  there is no per-installation switch, and a build that carries a module
  carries it everywhere it is installed.
- A module follows every Portta rule — boundaries, permissions, OpenAPI,
  translations — because it lives inside the workspaces that enforce them.
- The one new workspace, `packages/host`, is generic
  ([ADR 0047](0047-host-daemon-and-panel-proxy.md)); it is not a module's
  package.
