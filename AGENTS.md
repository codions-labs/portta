# Agent index

Rules live next to the work they govern. This file is an index and a set of
repository-wide operating rules, not a second copy of the documentation.

* [Safe operating rules](docs/agent-guidelines.md) — what an agent must never do on a shared development host
* [Monorepo layout](docs/development/monorepo.md) — where new code goes, workspace boundaries, and how to add a command
* [Shell scripts](docs/development/scripts.md) — the shell boundaries that exist, and why a new script belongs in the CLI
* [Testing](docs/development/testing.md) — testing layers, ownership, costs, and release validation
* [Architecture decisions](docs/development/adr/README.md) — decisions that are expensive to reverse
* [Documentation index](docs/README.md)

Per-directory `AGENTS.md` files are added only when a workspace has rules that
are not true of the rest of the repository.

---

## Testing policy for agents

Test relevant behavior, not trivial details. The cost of creating, maintaining
and running a test must match the risk it covers. If a test costs more to keep
than the value it delivers, it should not exist.

### What to write

Write tests for business rules, refusals, contracts, authorization, secrets,
data-loss paths and regressions with real impact. Prefer unit and integration
tests of that essential behavior.

Use TDD when it helps design the behavior. Do not treat it as an obligation for
trivial changes.

Do not test every combination, internal implementation details, or a rule
already covered at another layer. Do not add tests only for coverage or generic
precaution.

End-to-end tests exist only for critical flows, important integrations or a
concrete regression risk. Do not run Playwright, gateway E2E or
`test:integration` because frontend or API code changed.

### Trivial UI

Do not create or keep automated tests for simple visual details: color, size,
position, spacing, copy, icons, styles or one-off layout tweaks.

Validate those changes with `playwright-cli`: open the app, navigate, interact,
check the result and take a screenshot when needed. Prefer that over a test
file.

### How to run

The default is **targeted validation**, not full regression.

> **Run the smallest test that can reasonably prove the change. Do not run a
> broader suite merely because an implementation step is finished.**

**While implementing:** after a coherent change, run the matching file or `-t`
case (and tests the change added). Do not test after every edited file.

```bash
npm test --workspace=portta-server -- apply
npm test --workspace=portta-server -- tests/apply.test.ts -t 'reports one that is running'
npm test --workspace=portta-web -- --project ui settings
npm test --workspace=portta-web -- --project logic tests/logic/health.test.ts
npm test --workspace=portta-core -- namespace
bash tests/unit/boundaries.test.sh
```

**Finishing an ordinary task:** targeted tests, then the owning workspace only
if several modules there actually changed, then a contract/schema check only if
that boundary moved. Stop once the affected scope passes.

Do **not** run `npm run test:integration`, `npm test`, `npm test --workspaces`,
`npm run test:e2e` or `npm run test:release` for an ordinary change, handoff or
feature increment. If the user will run broad regression later, respect that.

**Integration, merge and release:** `npm run test:integration` belongs to a
meaningful merge, a release candidate, a change to the test runner itself, or
a structural blast radius that targeted suites cannot cover. Release validation
is in [docs/development/testing.md](docs/development/testing.md).

If broader regression would help but was not requested, recommend it at the end
instead of running it.

### Scope

This table is the **maximum** default, not the minimum. Prefer a file or `-t`.

| Changed area                                                   | Default validation                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/core/src/**`                                         | matching `portta-core` test file/name                                                        |
| `packages/contracts/src/**`                                    | matching `portta-contracts` test + `openapi:check` only when the contract/OpenAPI can change; `openapi:taskflow:check` for `packages/contracts/src/taskflow/**` |
| `packages/db/src/schema/**`                                    | matching `portta-db` test + `db:check` when schema/migrations change                         |
| `packages/auth/src/**`                                         | matching `portta-auth-core` test                                                             |
| `packages/server/src/**`                                       | matching `portta-server` test file/name                                                      |
| `packages/cli/src/**`                                          | matching `@codions/portta` test file/name                                                    |
| `apps/auth/src/**`                                             | matching `portta-auth` test                                                                  |
| `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**` | matching `portta-web --project ui` or `logic` test                                           |
| `apps/web/server/**`                                           | matching `portta-web --project server` test                                                  |
| `apps/web/lib/docs/**`                                         | matching `portta-web --project docs` test                                                    |
| API contract/schema change                                     | relevant test + `npm run openapi:check --workspace=portta-contracts`                         |
| `scripts/**`, `bin/portta`                                     | `bash tests/lint.sh` (ShellCheck over `scripts/` and `tests/`, Compose validation; needs Docker); the CLI test when `bin/portta` changes |
| Compose/profile change                                         | only the affected profile/template test first                                                |
| documentation-only change                                      | no application test unless generated/validated behavior is affected                          |
| copy, labels or purely visual changes                          | `playwright-cli`; no automated test file                                                     |

A whole workspace suite is the fallback when no trustworthy narrower test
exists. Shared packages get more care at the actual consumer boundary, not a
repository-wide run.

Do not rerun a passing test when nothing relevant changed. Do not use root
`npm test` as a substitute for the affected workspace. Do not expand scope
because an unrelated environment failure appeared; identify that and report it.

The same affected-scope rule applies to `typecheck` and `build`: workspace-scoped
when compilation matters; repository-wide only when build, packaging or generated
output changed.

### Reporting

```text
Validation:
- portta-server: apply.test.ts
- portta-contracts: openapi:check

Full regression was not run; this change did not require release-level
validation.
```

If another document can be read as requiring `test:integration`, all workspace
tests, E2E or Playwright after every ordinary feature, that reading is wrong.
Agent default: **targeted while developing → affected scope when finishing →
full regression at integration/release.**

`npm run test:affected` lists tests for the local diff; it does not execute
them. Review, then `--run` if the scope fits. Unmapped paths block execution;
E2E stays explicit. A Vitest success with zero matches is not validation.
Pure web helpers live in `tests/logic` (`--project logic`).

`npm run test:e2e -- --suite NAME` for gateway scenarios; direct shell E2E on
the shared host is refused. Never bypass the disposable-host guard.
