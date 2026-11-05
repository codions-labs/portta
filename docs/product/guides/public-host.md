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
  repository. Cloudflare is the supported provider; for another one see
  [Configure DNS and TLS](dns-and-tls.md).

The [deploy guide](deploy.md) walks through the DNS records and the token.

## Configuration

`portta public init --domain example.com --email you@example.com --cloudflare-token-stdin --yes < token-file`
writes all of these in one step, prints the DNS records to create and starts
nothing (`--dry-run` shows the plan first). To set them by hand, these keys go
in `~/portta/.env` (or are set with `portta config set`):

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
CF_DNS_API_TOKEN=<the token, never committed>
PORTTA_WEB=true
PORTTA_WEB_EXPOSE=domain
PORTTA_PANEL_ADVERTISED_HOST=example.com
PORTTA_AUTH_MODE=required
```

The panel then answers on `https://example.com` and asks for a login.

## The three states of a site

On the `remote-public` profile every routed service passes through the
ForwardAuth middleware. Each hostname is in one of three states, recorded in
the registry, `state/auth/protections.json`:

| State | What a visitor sees |
|---|---|
| Protected | A login page; the right password reaches the application |
| Open | The application, with no login |
| Closed | Nothing: nobody decided, so the answer is a refusal |

Because the decision lives in the registry and not in your Compose file, you can
change it at any time, from the CLI or the panel, and it applies on the next
request. No container is recreated and your Compose file is never edited. A
closed hostname answers `401` with an empty body.

A project that declares Traefik routing of its own (`traefik.*` router labels)
is refused on a public host, because Portta cannot put that router behind
ForwardAuth. A project adopted with `--manual` is reported as a finding for the
same reason.

## Deciding when you adopt

On a public host, `portta adopt` stops until each routed service has a decision:

```bash
portta adopt /srv/shop --protect web --public api
```

`--protect` generates a password and prints it **once**; only a hash is stored.
`--public` lets everybody open the service. Give the password to whoever needs
it. Running `adopt` or `runtime up` again does not ask twice. Without a flag,
`adopt` stops and `adopt --dry-run` lists the pending decision as
`public_exposure`, one for each routed service.

Later, change a hostname directly:

```bash
portta protect host shop--web.example.com     # a new password, shown once
portta protect open shop--web.example.com     # open to everybody
portta protect remove shop--web.example.com   # closed again
portta protect status                        # every decision, without credentials
```

## Access for a client

From the service drawer in the panel, in the Share with a client section:
protect the service with a password (**Whoever has the password**) and give the
person the URL and the password, or create a temporary link that expires on its
own (1, 4 or 24 hours). Deciding for a hostname needs the `service:protect`
permission, which only the owner and administrators hold. A temporary link has
its own hostname, `<project>--<service>--share-<id>.<domain>`, one DNS label deep
so the wildcard certificate covers it. Temporary links are created from the
panel and the API, not the CLI.

## Operating projects from the panel

By default the panel only observes on a public host. To let a signed-in session
start, stop and remove projects, the runner has to be on (`PORTTA_RUNNER=true`,
the default in `.env.example`) and all of these must be set:

```env
PORTTA_RUNNER_PUBLIC=true
PORTTA_WEB_EXPOSE=domain
PORTTA_AUTH_MODE=required
TLS_ENABLED=true
```

Otherwise the runner is not prepared and the panel says why. Applying saved
settings from the panel is always refused on a public host: run `portta up` on
the host.

Starting and stopping projects hands Compose to anyone who can sign in to the
panel. Keep accounts few, turn on two-factor authentication (the container
console requires it when the panel is exposed on a domain or publicly), and
understand that a compromised account can operate every project. The setting is
edited on the host: the panel cannot change it, and `portta doctor` warns while
it is on.

## Not supported: proxied DNS

Cloudflare's proxy (orange cloud) terminates TLS at Cloudflare. Portta assumes
the browser reaches Traefik directly: DNS-01 certificates, the client address in
the login rate limit and WebSocket behaviour all rely on it. Use DNS only.

## Moving to a private network later

Nothing here locks you to the internet. To move to Tailscale, switch the
profile with `portta public disable`, enable the tailnet and keep the same
projects: protections and runtime plans are kept. See
[Choose remote access](remote-development.md).
