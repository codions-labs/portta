# 0036. The panel is a Next application on a server of its own

**Status:** Accepted

## Context

The panel signs people in, and a session cookie belongs to one origin. A
single-page application on one port talking to an API on another would need
either two origins and a cookie that does not travel, or a proxy in front of
the panel whose only job is to make the two look like one — a third moving
part, in a product whose whole promise is a small permanent footprint.

A client-rendered application has a second problem. Every screen is rendered
empty and then filled by a fetch, which means every screen has a loading
state, a race, and a moment where a viewer sees controls they are about to be
told they cannot use. Deciding what somebody may see *before* the HTML is
written removes all three.

## Decision

The panel is a Next 16 application on the App Router, served by a Node HTTP
server the panel owns. One process, one port, four dispatches:

| Path | Handled by |
|---|---|
| `/api/*` | The Hono app: the whole API, and the event stream |
| `/ws/*` | The authorised upgrade handler ([ADR 0035](0035-authentication-lives-in-the-panel.md)) |
| `/_next/*` (development) | Next's own upgrade handler, for HMR |
| everything else | Next's request handler |

`apps/web/server/compose.ts` is that dispatcher and takes its handlers as
arguments, so a test drives the whole composition with a fake Next and no
Docker, no database and no port.

Pages are Server Components. Each one resolves its own principal and reads
through `services/reads.ts` — the same scope rules the API applies, called
directly rather than over HTTP — and hands the result to a client component as
`initialData`. React's `cache()` deduplicates a layout and its page asking for
the same Project. A page a role does not have calls `notFound()`, because a
page that is not part of somebody's panel is not a door with a sign on it.

`(panel)/layout.tsx` is the one entrance. There is no middleware: a `proxy.ts`
would run on every asset, could not reach the database, and would answer a
question the layout already answers once per render.

## Consequences

Titles come from each route's `generateMetadata`; navigation is the App
Router's; the documentation at `/docs` is prerendered from the repository's
own Markdown at build time.

`portta-server` stays a library rather than a service: it exports `createApp`,
the read functions and the realtime pieces, and `apps/web/server/main.ts`
composes them. Nothing in it imports Next, so the API can still be reasoned
about — and tested — without a bundler.

Two costs, taken deliberately. The panel needs a build step that produces
`.next`, which the image does and a developer does with `portta web dev`. And
`portta-server`, `portta-auth-core`, `portta-db` and their native dependencies
are `serverExternalPackages`: they open sockets and resolve paths from
`import.meta.url`, which a bundler cannot follow. A client component that
imports one of them fails at build time, which is the correct direction to
fail.
