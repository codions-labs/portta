# Workflow authoring

Taskflow workflows are plain JavaScript programs that orchestrate coding agents through a deterministic injected DSL. They can run as Project-scoped durable Workflow Runs or through the standalone engine CLI.

## Catalog and commands

Workflow names resolve by `meta.name` in this order:

1. `.portta/workflows/` in the current Project;
2. `workflows/` in the host daemon's state directory (`~/portta/state/host/workflows/` for a default installation) for the current user; and
3. the built-ins bundled with Portta.

A higher tier shadows the same name in a lower tier. Invalid definitions and same-tier collisions are reported rather than selected arbitrarily.

```bash
portta flow workflows list
portta flow workflows validate .portta/workflows/audit.workflow.js
portta flow run workflow audit --input-json '{"target":"src"}'
```

The lower-level standalone interface is:

```bash
portta flow workflows run audit --args '{"target":"src"}'
```

Use the durable `portta flow run workflow` form for Project workspace ownership, unified Run history, dashboard controls, and immutable definition snapshots. Use the standalone form for direct engine experimentation and options such as token budgets and fake workers. The `// Run with:` header of every built-in under `packages/host/workflows/` shows both forms in that order: `portta flow run workflow <id>` first, `portta flow workflows run <id>` second.

## Minimal workflow

```js
export const meta = {
  name: "inspect-auth",
  description: "Inspect authentication from independent perspectives",
  phases: [
    { title: "Inspect", detail: "parallel focused readers" },
    { title: "Synthesize", detail: "one actionable report" },
  ],
  workspace: {
    default: "current_branch",
    allowed: ["current_branch", "isolated_worktree"],
    mutatesRepository: false,
    reason: "This workflow only reads the repository.",
  },
}

phase("Inspect")
const reports = await parallel([
  () => agent("Inspect authentication boundaries and return concrete risks."),
  () => agent("Inspect authentication tests and identify missing cases."),
])

phase("Synthesize")
return await agent(
  `Merge these reports into a prioritized result:\n${JSON.stringify(reports.filter(Boolean))}`,
)
```

The file must begin with a pure-literal `export const meta = {...}`. Do not use variables, calls, spreads, computed keys, or interpolation in metadata.

## Metadata

Required fields:

- `name` — catalog identifier;
- `description` — one-line purpose.

Optional fields include `phases`, paired `defaultProvider`/`defaultModel`, `defaultSandbox`, `whenToUse`, and `workspace`.

Workspace metadata declares:

```js
workspace: {
  default: "isolated_worktree",
  allowed: ["isolated_worktree", "new_branch", "current_branch"],
  mutatesRepository: true,
  reason: "Agents may prepare fixes.",
}
```

Use the exact same phase titles in `meta.phases` and `phase()` calls when they should share a progress group.

## Injected API

### `agent(prompt, options)`

Spawns one real agent and returns its final text. With `schema`, the provider is required to return JSON matching that schema and the validated object is returned.

Important options:

- paired `provider` and `model`;
- `effort`;
- `schema`, `label`, and `phase`;
- `sandbox`: `read-only`, `workspace-write`, or `danger-full-access`;
- `approval`, `cwd`, `instructions`, and provider-supported `maxTurns`;
- `worktree`: request a child isolated workspace; and
- `key`: stable resume identity.

If the user skips an agent, `agent()` resolves to `null`. Filter nullable results before synthesis.

### `pipeline(items, ...stages)`

Processes every item through its stages without a barrier between stages. Each stage receives `(previousResult, originalItem, index)`. A failed item becomes null and skips its remaining stages.

Prefer `pipeline()` for multi-stage fan-out because fast items can advance while slower items remain in earlier stages.

### `parallel(thunks)`

Runs all thunks concurrently and waits for the entire set. Failed thunks become null instead of rejecting the aggregate. Use a barrier only when the next step needs cross-item context such as deduplication or a global early exit.

### Other globals

- `phase(title)` changes the active progress group.
- `log(message)` emits user-visible progress.
- `args` contains the supplied input.
- `budget.total`, `budget.spent()`, and `budget.remaining()` expose a standalone output-token ceiling.
- `now()` and `random()` provide deterministic, journal-seeded time and randomness.

## Determinism and sandbox

Workflow code runs in a hardened `node:vm` context without filesystem/network access or imports. Agents perform external work. Workflow source must be plain JavaScript, not TypeScript.

The engine rejects nondeterministic constructs that would invalidate replay. Use `now()` and `random()` instead of `Date.now()`, argument-less `new Date()`, or `Math.random()`. Inputs and return values must remain serializable across the VM boundary.

Limits protect accidental unbounded fan-out:

- standalone default concurrency: 100 active calls;
- lifetime agent-call cap: 1000; and
- maximum items in one `parallel()`/`pipeline()` call: 4096.

## Providers

Provider and model are always **both set or both omitted**. Omit both to inherit the Run default.

| Provider | Notes |
| --- | --- |
| `codex` | default; authenticated local Codex app-server; effort through `xhigh`; structured extraction |
| `claude-code` | Claude Agent SDK/CLI auth; supports tool permission mapping and structured output |
| `opencode` | OpenCode 1.16.2+; requires explicit `danger-full-access`; no enforceable confined sandbox or `maxTurns` |
| `pi` | Pi 0.79.1+; requires explicit `danger-full-access`; no enforceable confined sandbox or `maxTurns` |

A provider declared under `providers:` in `.portta/taskflow.yaml` is available to workflows on the ACP transport only; see the configuration reference.

Check the machine before a real run:

```bash
portta flow workflows doctor
```

OpenCode models use their `provider/model` form. Pi models use Pi's model reference. `effort` is normalized by each adapter to its closest supported thinking level.

## Structured results

Prefer schemas when a later stage consumes an earlier result:

```js
const FINDINGS = {
  type: "object",
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["file", "problem"],
        properties: {
          file: { type: "string" },
          problem: { type: "string" },
        },
      },
    },
  },
}

const result = await agent("Find concrete correctness problems.", { schema: FINDINGS })
return result.items
```

Validation occurs at the worker boundary and the provider receives one corrective extraction attempt when supported.

## Isolation for parallel writes

Run workspace ownership and per-agent worktrees solve different problems. Select the Run workspace at launch. Inside the workflow, request child worktrees only for concurrent writers:

```js
const attempts = await parallel([
  () => agent("Implement approach A", { sandbox: "workspace-write", worktree: "approach-a" }),
  () => agent("Implement approach B", { sandbox: "workspace-write", worktree: "approach-b" }),
])
```

Taskflow grants and releases these leases. Workflow code must not invoke `git worktree add/remove` for them.

## Resume and stable keys

Completed calls are keyed from deterministic call context and persisted in the journal. `key` can pin a call across harmless prompt rewording or reordering:

```js
await agent("Re-check the public API", { key: "public-api-review-v1" })
```

Changing semantically keyed options invalidates the cached call. Interrupted calls rerun. Durable Taskflow Runs resume from their stored workflow snapshot and original input.

## Built-ins

- `deep-research` — broad research fan-out followed by synthesis.
- `code-review` — dimension-based review and verification.
- `multi-provider-review` — independent provider reviews merged into one ranked report.
- `bake-off` — isolated implementations judged against each other.
- `provider-debate` — propose, attack, rebut, and adjudicate.
- `second-opinion` — inexpensive dual answers with deep escalation only on disagreement.

Inspect the canonical implementations under `packages/host/workflows/`.

## Authoring patterns

- **Explore then orchestrate:** inspect enough of the repository to discover the item list, then pipeline over it.
- **Adversarial verification:** ask independent agents to refute a candidate finding before accepting it.
- **Judge panel:** generate distinct approaches, score them independently, and synthesize the winner with useful parts of the alternatives.
- **Loop until dry:** continue discovery until repeated rounds find nothing new; deduplicate against every seen item, not only accepted items.
- **Completeness critic:** end with a pass that asks which source, modality, or claim remains uncovered.
- **No silent caps:** log sampling or truncation so partial coverage is never presented as exhaustive.

## Save and install the authoring guide

```bash
portta flow workflows save ./audit.workflow.js --project
portta flow workflows guide
```

Install the skill into your coding agents with the [Skills CLI](https://www.skills.sh):

```bash
npx skills add codions-labs/portta --skill portta-workflows -g
```

The packaged source of the agent-facing guide is `skills/portta-workflows/SKILL.md`. Keep behavior changes synchronized with this document and CLI help.
