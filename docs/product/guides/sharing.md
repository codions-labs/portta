# Share a service

Somebody wants to look at the branch you are on. A share is "show this one
thing to this one person until tomorrow": an **additional hostname** for one
service, with an expiry, and it changes nothing about the project. Routing on
the VPN reaches everyone on the tailnet, and `PUBLIC_ENABLED=true` puts
**every opted-in service on the host** on the internet; a share is neither.

```text
Exposure   Protected · reviewer · expires in 6 h        Revoke   Regenerate
           https://storefront-web-a7f3.share.dev.example.com
```

## The three states

| State | What it is |
|---|---|
| `private` | **The absence of a share.** The default. Not a deny rule, and nothing is written anywhere |
| `protected` | An additional hostname behind a generated password |
| `public` | An additional hostname with no password. Refused unless `PUBLIC_ENABLED=true` and `PUBLIC_DOMAIN` is set |

Shared hostnames live under `share.<domain>`, kept visibly apart from project
hostnames and covered by one wildcard record.

## Making one

From the panel: open a service, and the Exposure section offers an expiry and
the two modes. That is where the decision is made, so that is where the button
is; the CLI manages what already exists.

A protected share generates its password (twenty characters over a thirty-two
symbol alphabet, so about a hundred bits), **shows it exactly once**, and stores
only its scrypt hash in `state/auth/protections.json`. No API response ever contains it again, and regenerating
replaces the hash and shows a new one, which is also what you do when you lose
it.

## Managing them

```bash
portta share list          # every share, its mode, and when it expires
portta share revoke a7f3   # remove one
portta share gc            # remove the ones that have expired
```

The panel and the CLI manage the same objects, the way they already do for
[access bridges](tcp-access.md). Active shares are counted on the Overview, and
expired or dangling ones show up in the diagnostics, because an exposure nobody
remembers is exactly the one worth surfacing.

## What is actually written

One generated file, `config/traefik/dynamic/portta-shares.yaml`, which
Traefik already watches and hot-reloads:

```yaml
http:
  routers:
    portta-share-a7f3:
      rule: "Host(`storefront-web-a7f3.share.dev.example.com`)"
      entryPoints: [websecure]
      middlewares: [portta-forward-auth]
      service: portta-share-a7f3
  services:
    portta-share-a7f3:
      loadBalancer:
        servers:
          - url: "http://storefront-web-1:3000"
```

The credential is not in this YAML. `portta-auth.yaml` defines the shared
middleware and the reserved login router; the auth service reads the private
store read-only.

Two details that matter:

**The backend is the container name, never the Compose service alias.** On the
shared network two projects can both alias `web`, and only the container name
is unique. The cost is that recreating the container under a different
namespace breaks the share, which a diagnostic then flags.

**The project's own router is untouched.** A share is an addition, so revoking
one deletes a block from this file and nothing about the project changes either
way. The panel cannot rewrite a container's labels, and would not if it could:
that is the project's configuration, not the gateway's
([ADR 0001](../../development/adr/0001-decoupled-infrastructure.md)).

The panel may write exactly three filenames in that directory — `portta-shares.yaml`,
`portta-aliases.yaml` and `portta-auth.yaml` — and refuses every
other path in its own process, so `middlewares.yaml`, `tcp.yaml` and anything
you put there yourself are never touched
([ADR 0011](../../development/adr/0011-bounded-traefik-write-surface.md)).

## What is refused

Refusals rather than warnings, following the precedent
`portta service publish` already set for datastores:

- **a service whose kind is not `http`.** A database is reached with
  `portta access open` or by hostname on its own entrypoint, never on the
  web entrypoint. See [Open a TCP bridge](tcp-access.md).
- **a service that is not on the shared network.** Traefik dials backends over
  it; a service that never joined has nothing to route to.
- **`public` without `PUBLIC_ENABLED` and `PUBLIC_DOMAIN`.**
- **`protected` when TLS is off on a remote profile.** A password sent in clear
  is not protection, and pretending otherwise is worse than refusing.
- **an expiry outside one minute to seven days.** There is no unlimited share:
  an exposure with no end is one nobody remembers to close.
- **a second share for the same container.** Revoke or regenerate the one that
  exists.

## What this is not

Not multi-user identity for your project. One credential, no users and no roles:
it is a door you open for an afternoon. See [Configure authentication](authentication.md)
for protecting a project-owned router with the same login.

Not a tunnel either. A share is only reachable where the gateway already is: on
the VPN for the private profile, on the internet only when public access is
already enabled. It exposes one more hostname, never one more network.
