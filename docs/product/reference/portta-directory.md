# The `.portta` directory

A project tells Portta what it is by keeping a `.portta/` directory in its own
repository. Everything there travels with the clone and means the same thing on
a laptop, in a homelab and on a development VPS.

The rule that decides what belongs there is one sentence
([ADR 0052](../../development/adr/0052-the-portta-directory-is-the-project-contract.md)):

> `.portta/` describes what the project **is and needs**. It never describes
> **where the project is running**.

## What is in it

| Path | Committed | What it holds |
|---|---|---|
| `project.yaml` | optional | the project's identity and conventions |
| `runtime.json` | optional | the Compose input set, profiles, and which services have an HTTP surface |
| `workflows/` | yes | the project's own multi-agent workflows |
| `taskflow.yaml` | yes | the Taskflow module's project settings |
| `taskflow.local.yaml` | **no** | machine-specific overrides for the above |
| `worktrees/` | **no** | the checkouts Git creates for parallel work |

A project uses only what it needs. A repository with no `.portta/` at all is a
normal case: `portta adopt` derives a plan and keeps it in the installation's
own state instead.

## The dividing line

| Belongs to the **project** — committed | Belongs to the **host** — never committed |
|---|---|
| Name, main branch, stack | Domain, subdomain, hostname, IP address |
| Compose files and profiles | TLS material and certificates |
| Which service is an HTTP surface, and its **internal** port | Published host ports |
| Branch-name pattern | Absolute paths, Projects Home |
| Worktree root, relative to the repository | Tunnels, VPN membership, credentials |
| Workflows and lifecycle hooks | The concrete Compose namespace |
| Which instruction files an agent should read | Multiplexer and environment provider choice |

Host-shaped settings live in the installation directory (`~/portta` by default,
or wherever `PORTTA_HOME` points), in a `*.local.yaml` overlay beside the
committed file, or are derived at runtime.

The test, when it is not obvious: *would two machines running this same commit
legitimately disagree about it?* If they would, it belongs to the host.

## `project.yaml`

What the project is, and the conventions work follows in it. Every field is
optional except `version`, and a project with no file at all is a normal case —
the defaults below are what it gets.

```yaml
version: 1
name: demo-shop
mainBranch: main
worktrees:
  root: .portta/worktrees
  branchPattern: "{type}/{slug}"
stack: [node, mysql]
instructions: [AGENTS.md]
```

| Field | Default | Meaning |
|---|---|---|
| `version` | — | required; a reader refuses a version it does not understand |
| `name` | the directory | the project's own name |
| `mainBranch` | the repository's | the branch work is cut from |
| `worktrees.root` | `.portta/worktrees` | where worktrees live, always relative to the repository |
| `worktrees.branchPattern` | `{type}/{slug}` | accepts `{type}` and `{slug}`; an unknown placeholder is refused |
| `stack` | empty | informative only; never decides behaviour |
| `instructions` | empty | which instruction files an agent should read here |

**It carries no services, ports, Compose files or profiles.** Those describe how
the runtime comes up, and they already live in `runtime.json`; a second copy
here would be two answers to one question.

The schema refuses what belongs to the host rather than ignoring it: a URL, an
absolute path, a `~`-relative path, a published host port, a root that escapes
the repository with `..`, and any key it does not know — so `domain:` or
`port:` is an error, not a field that quietly travels.

## `runtime.json`

Written by `portta adopt` into the installation's state, or provided by the
project when it wants to version its adoption intent. It carries the Compose
input set, profiles, the auto/manual mode, per-service HTTP ports, and explicit
compatibility acknowledgements:

```json
{
  "schemaVersion": 1,
  "driver": "compose",
  "compose": { "files": ["compose.yaml"], "profiles": [], "mode": "auto" },
  "services": { "web": { "http": { "port": 3000 } } },
  "compatibility": {
    "removeContainerNames": [],
    "allowSharedNetworks": false,
    "allowSharedVolumes": false
  }
}
```

The port is the one the container listens on, not one published on the host.
Two worktrees of the same project both use `3000` and never collide, because
isolation comes from the environment namespace and the URL comes from the
gateway.

There is no domain, URL, label, network or Compose project name in this file,
and none may be added: those are resolved per host. See
[Add an existing project](../guides/adopting-projects.md).

## Overlays

A machine-specific override is always a separate file ending in `.local.yaml`,
never a section inside a committed one. `taskflow.local.yaml` may override the
multiplexer, the worktree root, auto-pull, integration toggles, profiles,
custom agents and lifecycle hooks; the committed file stays portable.

Add the overlays and the worktree checkouts to the project's ignore rules:

```gitignore
.portta/*.local.yaml
.portta/worktrees/
```

Do not put secrets in either file. Secrets belong in the installation's
environment.

## Versioning

Every file under `.portta/` carries an explicit schema version — `schemaVersion`
in JSON, `version` in YAML — so a reader can refuse a file it does not
understand instead of guessing.

## Related

- [Projects, environments and services](../concepts/project-model.md)
- [Add an existing project](../guides/adopting-projects.md)
- [The working agreement](../concepts/working-agreement.md)
- [ADR 0052](../../development/adr/0052-the-portta-directory-is-the-project-contract.md)
