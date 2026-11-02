# Run a public host

The main scenario: one server on the internet, many projects, each at
`project-service.<domain>` over HTTPS, and a clear answer for every site to who
may open it.

Read [Enable public access](public-access.md) for what the profile changes, and
use the [deploy guide](deploy.md) for a first installation step by step.

## What you need

- A server with Docker, ports 80 and 443 free and reachable.
- A domain whose DNS you control, with a wildcard record `*.<domain>` pointing at
  the server. Use **DNS only** (not proxied) at Cloudflare or any provider.
- A DNS API token restricted to that zone, so Portta can answer the ACME DNS-01
  challenge for a wildcard certificate. It is stored on the host, never in a
  repository.

## Configuration

These keys go in `~/portta/.env` (or are set with `portta config set`):

```env
PORTTA_PROFILE=remote-public
PUBLIC_ENABLED=true
PUBLIC_DOMAIN=example.com
PORTTA_DOMAIN_MODE=custom
PORTTA_DOMAIN=example.com
TLS_ENABLED=true
TLS_MODE=acme
ACME_EMAIL=you@example.com
ACME_DNS_PROVIDER=cloudflare
PORTTA_WEB_EXPOSE=domain
PORTTA_PANEL_ADVERTISED_HOST=example.com
PORTTA_AUTH_MODE=required
```

The panel then answers on `https://example.com` and asks for a login.

## The three states of a site

Every routed hostname is in one of three states, recorded in the ForwardAuth
registry:

| State | What a visitor sees |
|---|---|
| Protected | A login page; the right password reaches the application |
| Open | The application, with no login |
| Closed | Nothing: nobody decided, so the answer is a refusal |

Because the decision lives in the registry and not in your Compose file, you can
change it at any time, from the CLI or the panel, and it applies on the next
request. No container is recreated and your repository is never edited.

## Deciding when you adopt

On a public host, `portta adopt` stops until each routed service has a decision:

```bash
portta adopt /srv/shop --protect web --public api
```

`--protect` generates a password and prints it **once**; only a hash is stored.
Give it to whoever needs it. Running `adopt` or `runtime up` again does not ask
twice. Without a flag `adopt --dry-run` lists the pending decision as
`public_exposure`.

Later, change a hostname directly:

```bash
portta protect host shop-web.example.com     # a new password, shown once
portta protect open shop-web.example.com     # open to everybody
portta protect remove shop-web.example.com   # closed again
```

## Access for a client

From the service drawer in the panel: protect it with a password and copy the
URL and password together, or create a temporary link that expires on its own
(1, 4 or 24 hours). A temporary link has its own hostname,
`<project>-<service>-<id>-share.<domain>`, one DNS label deep so the wildcard
certificate covers it. Temporary links are created from the panel and the API,
not the CLI.

## Operating projects from the panel

By default the panel only observes on a public host. To let a signed-in session
start, stop and remove projects, set all of:

```env
PORTTA_RUNNER_PUBLIC=true
PORTTA_WEB_EXPOSE=domain
PORTTA_AUTH_MODE=required
TLS_ENABLED=true
```

This hands Compose to anyone who can sign in to the panel. Keep accounts few,
turn on two-factor authentication (the container console requires it on an
exposed panel), and understand that a compromised account can operate every
project. The setting is edited on the host: the panel cannot change it.

## Not supported: proxied DNS

Cloudflare's proxy (orange cloud) terminates TLS at Cloudflare. Portta assumes
the browser reaches Traefik directly: DNS-01 certificates, the client address in
the login rate limit and WebSocket behaviour all rely on it. Use DNS only.

## Moving to a private network later

Nothing here locks you to the internet. To move to Tailscale, switch the
profile with `portta public disable`, enable the tailnet and keep the same
projects: protections and runtime plans are kept. See
[Choose remote access](remote-development.md).
