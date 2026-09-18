# Templates

Reference overlays for the shapes a project usually has, for **manual mode**:
a project that owns its own `compose.portta.yaml` instead of the overlay
`portta adopt` generates (see
[Add an existing project](../docs/product/guides/adopting-projects.md#manual-mode)).
They are **references to copy from**, not runtime that projects depend on:
nothing here is included, mounted or extended by a consumer project. Copy the
closest one, adjust the service names and ports, and it is yours.

`portta envs init <path>` generates the same thing from a project's actual
Compose file, which is usually faster.

| Template | Shape |
|---|---|
| [`01-single-web.yaml`](overlays/01-single-web.yaml) | one HTTP service |
| [`02-web-api.yaml`](overlays/02-web-api.yaml) | web + API |
| [`03-web-api-postgres.yaml`](overlays/03-web-api-postgres.yaml) | web + API + a database that stays private |
| [`04-web-api-postgres-redis.yaml`](overlays/04-web-api-postgres-redis.yaml) | the common full stack |
| [`05-multiple-apis.yaml`](overlays/05-multiple-apis.yaml) | several APIs behind one namespace |
| [`06-monorepo.yaml`](overlays/06-monorepo.yaml) | `apps/` and `services/` in one repository |
| [`07-worktree.env`](overlays/07-worktree.env) | a second copy of a project, in parallel |
| [`08-nonstandard-port.yaml`](overlays/08-nonstandard-port.yaml) | an HTTP service on an unusual internal port |
| [`09-tcp-routing.yaml`](overlays/09-tcp-routing.yaml) | opt a datastore into hostname TCP routing |
| [`10-mailpit.yaml`](overlays/10-mailpit.yaml) | Mailpit UI on the gateway (SMTP stays private) |
| [`11-rustfs.yaml`](overlays/11-rustfs.yaml) | RustFS console on the gateway (S3 API stays private) |

## The two rules every template follows

**Labels are in list form.** Compose interpolates `${VAR}` inside a list entry
but **not** inside a mapping key. Written as a map, the Traefik service name
keeps the literal `${COMPOSE_PROJECT_NAME}` and every worktree of the project
collapses onto one load balancer.

**Traefik service names carry the namespace.** Those names are flat across the
whole host. Two projects declaring a bare `web` are merged into a single load
balancer and start serving each other's traffic.

`portta doctor` reports both.

## For the consumer repository

[`project/PORTTA.md`](project/PORTTA.md) is a short page to copy into
the project itself: how to start it, its URLs, how to reach its database, how
to run a second copy. It deliberately does not restate the gateway's
documentation; this repository stays the single source of the rules.
