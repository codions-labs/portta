# Use the Portta API

### API contract

The panel publishes an OpenAPI 3.1 contract at
`http://127.0.0.1:8081/api/openapi.json`. It is generated from the same route
registrations and Zod schemas the server and UI use: parameters, request
bodies, response shapes, status codes, read-only refusals and the SSE payload
are all part of the document. It declares the host-scoped Portta session and
Bearer tokens used by CLI and agent clients.

`http://127.0.0.1:8081/docs/api` renders that document: operations grouped by
tag, resolved schemas for parameters, request bodies and responses, the
declared security schemes, and a console.

The console executes a `GET` on a click. A `POST`, `PUT`, `PATCH` or `DELETE`
says what it is about to send and waits for a second, explicit confirmation,
because it is a real request against this panel. Read-only mode and the
same-origin write guard come back as the API's own error payload rather than as
a generic failure, so a refusal reads as a refusal.

It is enabled by default only while the panel stays on loopback. A routed panel
returns 404 unless `PORTTA_RUNTIME_API_DOCS=true` explicitly opts in. The JSON
contract stays available because a caller that reached the API can already
inspect it.

Checkout only: the contract is generated from the route descriptions and
checked in as `packages/contracts/openapi.json`, so an API change is visible in
review.

See [Authentication](authentication.md#tokens-for-the-cli-and-agents) for personal API tokens. The endpoint reference is served by this panel at `/docs/api`; the machine-readable contract is `/api/openapi.json`.

## The CLI's JSON contract

The HTTP surface is versioned by the OpenAPI document. The CLI's `--json`
output is versioned by an envelope on every command:

```json
{ "schema": "projects.context", "version": 1, "data": { } }
```

`schema` is the command path (`status`, `envs.list`, `projects.context`);
`version` is an integer that only advances on an incompatible change to
`data` — a field removed, a type changed or a meaning changed. An optional
field added is compatible and leaves the version alone. A script or an agent
reads the two fields first and stops on a `schema` or `version` it does not
know, instead of breaking on a silent change. The fields of `data` per command
are in the [CLI reference](../reference/cli.md#json-shapes).

The Development Context is versioned on its own as well, because it is read
over the API and MCP without the CLI: `GET /api/projects/:slug/context`
carries `schema: "development-context"` and `version: 1` in the body, under
the same rule.

## Query documentation

The same corpus served at `/docs` is available through authenticated read endpoints:

| Endpoint | Query | Response |
| --- | --- | --- |
| `GET /api/documentation` | Optional `audience` | Version identity, page metadata and navigation |
| `GET /api/documentation/search` | `q`, optional `audience`, `limit` | Ranked results with excerpts and anchors |
| `GET /api/documentation/page` | `slug`, optional `anchor` | Markdown for a page or heading subtree |

`audience` is `user`, `developer` or `all` (default). Search accepts 1–50 results and defaults to 10. A missing page or anchor returns 404; invalid input returns 400. Disabling documentation also disables these endpoints.

```bash
curl --fail --get http://127.0.0.1:8081/api/documentation/search \
  --data-urlencode 'q=custom domain' \
  --data-urlencode 'audience=user'
```

On a panel with `PORTTA_AUTH_MODE=required`, add an `Authorization: Bearer ptt_…` header using your Portta token. Every response identifies the corpus version and hash. The OpenAPI document describes the complete schemas.
