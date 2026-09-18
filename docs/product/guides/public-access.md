# Enable public access

Open the gateway's
[Project access settings](http://127.0.0.1:8081/settings/general/project-access) to edit
the managed keys from the panel.

Disabled by default. Turning it on is the most consequential thing the gateway
can do, so it is explicit, it shows you exactly what changes, and it asks.

## Enabling

```bash
portta public enable
```

It resolves the domain that would go public — `PUBLIC_DOMAIN` if set,
otherwise the already-configured project domain, as long as it isn't
`localhost`. Without either it refuses, pointing at
`portta config set domain.mode auto`. It also refuses while a TCP entrypoint is
active.

Then it asks a single confirmation naming that domain:

```
expose opted-in HTTP services on *.dev.example.com? [y/N]
```

On yes it sets `PUBLIC_ENABLED=true` and `PORTTA_PROFILE=remote-public` in
`.env` and immediately runs `docker compose up -d` to apply it.

```bash
portta public status
portta public disable
```

`disable` sets `PUBLIC_ENABLED=false` and always switches `PORTTA_PROFILE`
back to `remote-private`, then tells you to run `portta up` to apply it — it
does not restart anything itself. Consumer projects keep running throughout.

## What public mode does and does not change

It changes **who can reach Traefik**. That is all.

It does not publish anything new. A service is still routed only when it sets
`traefik.enable=true`, and databases and caches are still never on the shared
network. What was invisible stays invisible; what was already routed becomes
reachable from the internet.

Never public, in any profile:

- PostgreSQL, MySQL, Redis, MongoDB and other datastores
- the Docker API and the socket proxy
- the Traefik dashboard

`doctor` and the CI exposure job both fail if any of those bind `0.0.0.0`.

## Prerequisites

```env
PUBLIC_ENABLED=false          # public enable flips this
PUBLIC_DOMAIN=dev.example.com
TLS_ENABLED=true
TLS_MODE=acme
ACME_EMAIL=you@example.com
```

`public enable` refuses when no public domain can be resolved (`PUBLIC_DOMAIN`,
or an already-configured non-`localhost` project domain), and while a TCP
entrypoint is active.

A wildcard `A` record for `*.dev.example.com` must point at the host's public
address: `portta dns setup --target <ip>`.

Firewall: 80 and 443 have to be open. Nothing else does. See
[Configure firewall rules](firewall.md).

## Hardening

Public mode raises `aliasHeadersStrategy` to `delete`, so a client cannot
forge a header Traefik manages by exploiting a backend that normalises
underscores.

Anything routed is public unless its router opts into authentication. Portta
ships a working ForwardAuth middleware and one credential per protected host:

```bash
portta protect host demo-web.example.com --project demo --service web
```

The router then opts in with a label the project owns; see
[Protecting a project hostname](authentication.md#protecting-a-project-hostname).

## Deciding

Use the private profile. It is the default recommendation because it gives you
the same thing, remote access from anywhere, without an open port.

Public mode earns its keep for external webhooks, a demo for someone who cannot
join your tailnet, or testing something that must see a public certificate.
When the reason passes, turn it off:

```bash
portta public disable
```
