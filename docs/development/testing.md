# Testing

> Targeted while developing → affected scope when finishing an ordinary task →
> broad regression at integration → full/E2E for release or an explicit reason.

Finishing a feature increment, answering a user, or handing off a small task is
not an integration milestone. Run the smallest test that protects the changed
behavior. Do not repeat passing checks unless relevant code changed afterward.
The agent policy in [AGENTS.md](../../AGENTS.md) governs what to test and
which tests to run. Keep a test only when its value clearly justifies the time
to create, run and maintain it.

## Choose a test

What to test, and which command to run for a changed area, is the
[testing policy in AGENTS.md](../../AGENTS.md#testing-policy-for-agents); this
page is the mechanics. Every Node workspace accepts a Vitest filename and
test-name filter. Prefer a full relative filename; a substring such as `issues`
can select several files. Combine a filename with `-t` to avoid importing
unrelated files. Check the executed test count: Vitest can exit successfully
when a name matches no cases. For a module, give its test directory or several
filenames. A workspace suite is the fallback when no reliable narrower
selection exists. Types have the same scope:
`npm run typecheck --workspace=portta-server`, for example.

```bash
npm run test:affected                        # list local changes against HEAD
npm run test:affected -- --base origin/main  # merge-base plus all local changes
npm run test:affected -- --base origin/main --run
```

The selector shows the changed files, commands, reasons, recommendations and
unmapped paths. It includes staged, unstaged, untracked, renamed and removed
files. `--run` refuses a plan with gaps before executing anything. Source files
without an exact test fall back to their workspace; shared packages select
transitive workspace consumers. Configuration and unknown files require an
explicit integration decision. Browser and gateway scenarios are recommendations,
never silently started by diff selection. Reviewing a recommendation is still
necessary: a passing selected scope is not a release certificate.

The selector is deliberately conservative. It does not claim that an import
graph covers SQL, shell sourcing, dynamically imported files, or documentation
read from disk. No remote cache or external monorepo task system is required.

## Layers and commands

| Layer | Trigger | Command |
| --- | --- | --- |
| Development | A coherent small change | Filename/case commands above |
| Affected | Several related modules or a changed shared boundary | Review `test:affected`, then `--run` or explicit suites |
| Integration | PR/meaningful merge milestone | `npm run test:integration` |
| E2E | Changed real system interaction | `npm run test:e2e -- --suite lifecycle` or `--spec roles.spec.ts` |
| Release | Candidate before publishing | `npm run test:release` |

Integration runs static lint (including Compose), shell suites, tooling tests,
all workspace tests, scoped typechecks, OpenAPI and schema drift checks. It
builds core and CLI first so entrypoint smoke uses this checkout's compiled
entrypoint. It does not rebuild the panel or start lifecycle containers.
Some host-observation assertions are conditional; their skips are recorded.
The required static tool is Docker with the Compose plugin (`tests/run.mjs`
checks it first); Node dependencies and selected browser prerequisites must be
present. A name-filtered Vitest execution with zero cases fails in the
orchestrated commands.

`node tests/run.mjs` means integration with an explicit notice. `--lint` runs
static checks only, `--e2e` runs isolated system scenarios, and `--release`
runs the complete release gate. Extra or unknown arguments are errors.

`just test` is `node tests/run.mjs`, that is, integration; pass `--lint`,
`--e2e` or `--release` through it. Use the npm filename commands for routine
work.

Every orchestrated stage records wall-clock, status, command, skips and a log in
`test-results/<run>/`. Successful stages print a short summary; failed stages
print their diagnostics once. Browser JSON and failure traces live in
`apps/web/test-results/`. CI uploads these artifacts.

## Change-to-test matrix

The minimum is the directly related case/file, not every example in a row.
Widen only for an actual consumer, contract or risk. Integration below applies
to code/configuration PRs; documentation-only PRs check links. A release runs the
complete release gate once, rather than repeating it for each category.

| Change | Minimum | Widen when affected | Real-system check before merge when applicable |
| --- | --- | --- | --- |
| React component | UI file for functional behavior | Consumers, web types | Related browser interaction only if the flow is critical |
| Copy, colors, icons or styles | Review or `playwright-cli` | None | None |
| Width/layout tweaks | Review or `playwright-cli` | None | None automatically |
| API | Route case | Contract, service, authorization; OpenAPI if it can change | HTTP dispatcher/browser boundary |
| Service | Rule case | Routes and callers | External integration changed |
| Repository | In-memory SQLite query/write case | Service caller | Driver-specific behavior |
| Schema | Constraint/cascade test + `db:check` | Repositories | The generated SQL, read before committing |
| Migration | Fresh migration/idempotence/data preservation + `db:check` | Repositories | Upgrade against an existing installation's file |
| Contract | Schema test + OpenAPI if affected | Typed consumers and route | External API flow |
| Shared core | Core file | Consumers of the changed export | Parity/routing if changed |
| CLI | Command test | CLI build + entrypoint smoke if packaging changed | Relevant command scenario |
| Shell | Subject suite + shellcheck | None | Relevant gateway scenario |
| `portta setup` and the packaged runtime | `setup.test.ts`, `npm run test:package` | Refusal cases, `maintenance.test.ts` | Disposable install/lifecycle |
| Compose | Affected profile/template | Consumers and matrix | Affected live services |
| Traefik/TCP/TLS | Routing derivation/refusal | Compose and discovery | TCP/TLS with distinct databases |
| Authentication | Auth-core/ForwardAuth case | API security/principal/scope | auth/roles/settings as affected |
| Security | Changed refusal/boundary | All callers of the policy | Corresponding attack/session path |
| Documentation | Links | Docs collector if behavior changed | None automatically |
| Build/packaging | Owning build and entrypoint smoke | Types, consumers | Runtime image as affected |
| Monorepo structure | Boundaries and affected compilation | Transitive consumers | Integration, broader if impact is unclear |

## What the tests protect

The role matrix, API origin and scope guards, and browser session tests protect
different boundaries. An Engine API fake does not replace the Docker-backed
panel scenario.

Prefer assertions on observable arguments/results to source strings, labels or
class names. Do not remove a security assertion until another test demonstrably
protects the same failure mode. Don't use a browser or database just to test a
pure function; don't replace real constraints/transactions with permissive mocks.
Drive polling timers with fake timers where the timer is the subject. Do not
replace real socket or protocol behavior with artificial clocks.

The panel has four Vitest projects: `logic` (pure Node derivations), `ui`
(jsdom/components), `server` (Node dispatcher), and `docs` (Node collection).
The pools, worker defaults and per-file isolation remain unchanged. Do not turn
on `isolate: false` or concurrent cases over mutable fixtures merely to improve
a benchmark. Compare a representative sample before changing workers.

## The database under a test

`createTestDb()` opens `:memory:` through `better-sqlite3` and applies the real
migrations. The engine under a test is therefore the engine in production — same
driver, same generated SQL — so the CHECK constraints, the closed vocabularies
and the cascades are the real ones rather than a fake that was silently not
testing them.

There is no global setup, no cached image and no template. Building the schema
from the migrations takes single-digit milliseconds, so each call owns an
independent database and there is nothing to keep in step with a schema change.

Files with many cases still open one database per file and call
`resetTestDb(db)` before each case: it empties every table except the migration
journal and restarts the autoincrement counters. In server tests,
`databasePerFile()` returns a seeder that does exactly that. Real constraints,
cascades and transactions stay; only the connection is shared, never rows.

```ts
const { db, close } = await createTestDb()
// many cases in one file
const seeded = databasePerFile()
beforeEach(async () => { ({ db } = await seeded()) })
```

Auth harnesses pass a cheap password hasher through `AuthDeps.password`; one
bootstrap case keeps Better Auth's real scrypt so the production path stays
covered.

Always close instances. Schema tests retain real constraints, foreign keys,
transactions and sequences. Migration tests explicitly use fresh instances.
Snapshots contain no shared mutable rows. `seededDatabase()` adds the Project,
repository and environments needed by service tests. Avoid redundant seeds.

`db:check` copies schema/config/migrations to a temporary package, runs the
actual generator there, compares SQL and metadata, and removes the temporary
package even on failure. It never edits the checkout's journal or snapshots.

## E2E ownership, selection and CI

Gateway scripts refuse direct execution on a shared daemon. The launcher builds
a disposable host with its own Docker daemon, copies source (without local
credentials/state), and runs selected scenarios there. No host Docker socket or
host checkout is mounted. Cleanup verifies ownership and removes only that host
and its anonymous data volume. This requires Docker support for privileged
nested containers; failures are reported, never converted to skips.

Browser workers each own a panel process, an Engine API fake on a free loopback
port, and a SQLite file in a fresh temporary directory
(`apps/web/e2e/resources.mjs`), removed when the worker's panel closes. No
database container is involved. The browser never reuses a pre-existing
server. Every invocation builds dependencies and the panel once
before workers start. Concurrent E2E builds are refused by a lock.

Roles/settings fixtures create their own owner. Auth bootstrap stays a real UI
scenario, and its wrong-password test also works alone. Retries get fresh worker
resources. Native Playwright filters still work:

```bash
npm run test:e2e --workspace=portta-web -- roles.spec.ts
npm run test:e2e --workspace=portta-web -- auth.spec.ts -g 'password that is wrong'
```

The viewport check (`npm run viewports --workspace=portta-web`) uses the same
owned resources and walks the ten pages the panel serves without an account
(`apps/web/e2e/viewports.mjs`), asserting that none scrolls sideways and no
control ends up off-screen. The documentation screenshots are captured from a running
`just dev --demo` instead; see
[Regenerating the screenshots](development-setup.md#regenerating-the-screenshots).
Neither is an automated test to create or keep for simple visual changes. Use
`playwright-cli` for that kind of verification.

GitHub Actions runs `validation.yaml` in one of three modes, chosen by
`tests/lib/ci-scope.mjs`:

| Mode | When | What runs |
| --- | --- | --- |
| `pr` | pull requests | static, unit shards, and only the E2E the diff selects |
| `light` | push to `develop`/`main` before publishing | static and unit shards; never E2E (the PR already ran it) |
| `release` | GitHub Release | everything, including every gateway suite and browser spec |

Jobs run in parallel: `static` (`tests/run.mjs --integration --part static`:
lint, shell and tooling suites, types, OpenAPI, schema), three `unit` shards
(`--integration --workspaces …`: server, web, remaining packages) and, when
selected, `gateway-e2e` in two shards plus `browser-e2e`. Documentation-only
PRs run `docs:check` only. The lockfile, the root manifest, publication
workflows and `scripts/` do not start E2E by themselves; harness
changes run `lifecycle` as a smoke. `tests/tooling/selection.test.mjs` pins these rules.

Gateway shards build Portta's images on the runner with the GitHub Actions
build cache (`tests/docker/prepare-images.mjs`), pull the pinned third-party
images, and stream both into the disposable host (`PORTTA_E2E_PREBUILT_IMAGES=1`)
so the host neither rebuilds nor pulls, and no image archive is written to disk. Locally, without those variables, the
host builds everything as before.

Browser specs run in four Playwright projects (`open`, `auth`, `protected`,
`taskflow`) with three workers; each worker owns its database file, Engine API
fake and panel. `PORTTA_E2E_SKIP_BUILD=1` reuses an existing build. The
`taskflow` project is not part of CI's release scope: its fixture needs tmux
and a host daemon, so it runs locally with
`npm run test:e2e --workspace=portta-web -- --project taskflow`.

Publication (`publish.yaml`) depends on the validation job; failed prerequisites
or tests prevent publication. Development channels publish amd64 images;
releases add a native arm64 build and merge both into one manifest. The npm
package is published from `publish.yaml` itself with trusted publishing (OIDC).

## Measured costs

Suite and E2E measurements come from the stage reports in
`test-results/<run>/`, not from estimates in this document. Browser workers
print their panel startup time, migrations and seed included
(`E2E panel startup (includes migrations/seed)`).
