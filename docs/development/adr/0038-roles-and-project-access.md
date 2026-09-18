# 0038. Four roles, and access by Project

**Status:** Accepted; see [0035](0035-authentication-lives-in-the-panel.md)

## Context

Once the panel has accounts, "signed in" stops being an answer. A panel that
can start, stop and remove every container on a host, register repositories,
open bridges and rewrite the gateway's configuration cannot give the same
powers to everybody who has a password.

Two questions have to be answered separately, and conflating them is the
mistake to avoid: **what may this person do**, and **where**. A developer may
restart a service; that does not mean they may restart *your* service.

## Decision

**A flat vocabulary.** Permissions are `resource:action` — `issue:write`,
`environment:destroy`, `settings:manage` — generated from one statement table
in `packages/auth/src/access-control.ts`. Adding an action is one line there,
not five in five files. Better Auth's admin plugin authorises against exactly
this vocabulary, so its `user` and `session` resources are spread in rather
than restated.

**Four roles, and no more.** `owner`, `admin`, `developer`, `viewer`. Roles are
not editable: a product whose whole point is a small permanent footprint does
not need a role editor, and a team that needs one has outgrown a development
host. Impersonation is offered by the plugin and held by nobody.

**Every route declares its permission.** `documentRoute({ permission })`
registers it in the OpenAPI document as `x-portta-permission` and returns the
middleware that checks it. A test walks the document and fails if an operation
outside the three public routes declares none — which is what makes "did we
forget one" a build failure rather than an audit.

**Scope is checked after the resource is read.** The permission is checked at
the door, without a Project; the Project is checked in the handler, once the
resource has been read and it is known which one it belongs to. Which Project a
thing is in comes from where it actually lives: an environment from the
Project that adopted it, a repository from its row, a bridge from the
environment it targets. An environment nobody adopted belongs to nobody and is visible to
`owner` and `admin` alone.

**Listings filter; named resources refuse.** Asking for the Projects returns
yours, not a 403 about somebody else's. Asking for one by name that you are not
in is a 403. The Overview sums only what you can see and the event stream
delivers only events about it.

**The owner is a person, not a permission.** Some rules cannot be expressed as
a permission at all, and they live as `refusalFor*` helpers beside the service
that applies them: nobody changes their own role, nobody removes their own
account, only the owner acts on the owner, ownership is transferred rather than
assigned, and the last owner cannot be removed.

## Consequences

`401` and `403` mean different things and are tested as such: no credential is
401, a credential without the permission or the Project is 403.

Losing a membership closes the door on the next request rather than the next
sign-in, because the scope is resolved per request and the event stream re-reads
it while it is open.

A `viewer` still holds `token:*` for tokens of their own, which is the one thing
every role can do: a token never exceeds its owner, so a viewer's token is a
viewer.
