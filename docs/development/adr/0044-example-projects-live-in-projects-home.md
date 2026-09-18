# 0044. Example projects live in Projects Home

**Status:** Accepted; see [0019](0019-compose-files-live-under-docker.md), [0028](0028-operational-images-live-under-docker.md)

## Context

Runnable demonstrations kept inside the Portta repository would make consumer
projects part of the product checkout, deny each one its own Git history, and
make repository discovery unlike the normal Projects Home workflow they are
meant to demonstrate.

Tests need example-shaped projects too. Reading the runnable demonstrations
directly would make CI depend on sibling checkouts or remote repositories.

## Decision

Runnable examples are independent Git repositories at the first level of
`PORTTA_PROJECTS_HOME`. Their directory names begin with `portta-demo-` so demo
commands cannot accidentally start unrelated managed projects.

`portta dev` starts a checkout from local Dockerfiles without starting consumer
containers. `--demo` additionally starts the example Compose stacks.
`up --demo`, `dev --demo`, `down --demo` and `reset --demo` use the same
location.

Portta keeps reduced fixtures under `tests/fixtures/examples/` and
`apps/web/e2e/fixtures.mjs`. Those files exist solely to make automated
validation and documentation images deterministic; they are not runnable
product examples.

## Consequences

Developers configure one existing contract, `PORTTA_PROJECTS_HOME`, rather than
a second examples-only path. A checkout without the example repositories may
still run `dev`; it reports that example data was skipped. A `--demo` run fails
with an actionable path when no manifests are present.

The example repositories own their Compose files, manifests, documentation and
history. Portta's CI stays self-contained and does not fetch those repositories.
