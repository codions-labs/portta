# Deploy Portta on a server

From a fresh server to the first project reachable at
`project-service.example.com` over HTTPS, run by you, on a server you control.
It contains no real addresses: replace `example.com` and `203.0.113.10` with
your own domain and the server's public IP.

The steps, in order:

1. [Requirements](#1-requirements)
2. [Point the DNS at the server](#2-point-the-dns-at-the-server)
3. [Create a DNS token](#3-create-a-dns-token)
4. [Install](#4-install)
5. [Configure](#5-configure)
6. [Start and verify](#6-start-and-verify)
7. [Teach your agents](#7-teach-your-agents)
8. [Adopt a project](#8-adopt-a-project)
9. [Back up](#9-back-up)

## 1. Requirements

- A Linux or macOS server with a public IP address, Node 24 or newer with npm,
  Docker Engine 24 or newer with Compose 2.24.4 or newer, and `sqlite3` (for
  `portta db shell` and backups).
- Ports 80 and 443 free and open in the firewall. If another proxy or web server
  uses them, stop it first or Portta cannot start.
- A domain whose DNS you control. Cloudflare is the supported provider for the
  wildcard certificate; any other registrar works if you move the zone's DNS to
  Cloudflare, or use per-hostname certificates (see
  [Configure DNS and TLS](dns-and-tls.md)).

## 2. Point the DNS at the server

Create two records in the zone, both **DNS only** (the grey cloud at
Cloudflare, never the orange one):

| Type | Name | Content | Used for |
|---|---|---|---|
| `A` | `example.com` | `203.0.113.10` | the panel, at `https://example.com` |
| `A` | `*.example.com` | `203.0.113.10` | every project, at `https://project-service.example.com` |

The wildcard does not cover the domain itself, which is why there are two
records. Add `AAAA` records with the server's IPv6 address if it has one. A
name like `shop-web.example.com` needs no record of its own: the wildcard
answers for it, so a new project never touches the DNS again.

If you prefer the panel on its own name, such as `portta.example.com`, set
`PORTTA_PANEL_ADVERTISED_HOST` to it in step 5 and add one more `A` record.

Check it from anywhere, once the records exist:

```bash
dig +short example.com
dig +short anything.example.com      # both must print 203.0.113.10
```

Do not proxy the records. Cloudflare's proxy ends TLS at Cloudflare, which
breaks the certificate and the login rate limit. See
[Run a public host](public-host.md#not-supported-proxied-dns).

## 3. Create a DNS token

Portta asks Let's Encrypt for one wildcard certificate (`example.com` and
`*.example.com`) and proves it owns the domain by writing a temporary DNS
record. That needs a Cloudflare API token, and only this one:

1. Cloudflare dashboard, My Profile, API Tokens, Create Token.
2. Start from the template **Edit zone DNS**.
3. Permissions: **Zone, DNS, Edit**.
4. Zone Resources: **Include, Specific zone, example.com**.
5. Create it and copy the token. It is shown once.

Never use the Global API Key. The token stays in the installation's `.env` on
the server, which is not in any repository. More detail in
[Configure Cloudflare DNS](cloudflare.md).

## 4. Install

On the server:

```bash
npm install -g @codions/portta
portta setup
```

`setup` checks Node, Docker and Compose, asks one confirmation, installs the
runtime into `~/portta`, pulls the pinned images and starts the gateway on the
local profile. `portta setup --dry-run` shows what it would do without changing
anything.

To run the installer without installing the command first:

```bash
npx @codions/portta setup
```

`npx` only runs `setup` once. For everything after, including
`portta up`, `portta adopt` and the agents, you want the command installed, so
prefer `npm install -g`. Both end in the same installation.

To pin a release, add a version: `npm install -g @codions/portta@0.2.0`. Check
`portta version` afterwards. An existing installation is not updated for you;
see [Update Portta](update.md).

## 5. Configure

Let Portta write the settings. Save the token from step 3 in a file only you
can read, then:

```bash
portta public init --domain example.com --email you@example.com \
  --ip 203.0.113.10 --cloudflare-token-stdin --yes < token-file
```

The token is read from standard input, never from an argument, and is never
printed. Add `--dry-run` first to see the plan and the DNS records without
writing anything. `--panel-host panel.example.com` moves the panel off the
bare domain. The command writes `~/portta/.env`, starts nothing, and refuses
while TCP entrypoints are on or a running service has no login gate. Running
it again with the same arguments changes nothing.

The values it writes are the reference below. To set them by hand instead, open
`~/portta/.env` and set these, replacing the ones that exist:

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
CF_DNS_API_TOKEN=<the token from step 3>
PORTTA_WEB=true
PORTTA_WEB_EXPOSE=domain
PORTTA_PANEL_ADVERTISED_HOST=example.com
PORTTA_AUTH_MODE=required
```

What each group does is in [Run a public host](public-host.md). Keep the file
private: it holds the token. To test the whole flow without spending the
certificate rate limits, add
`ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory` first,
then remove it and run `portta up remote-public` again once it works.

## 6. Start and verify

```bash
portta up remote-public
portta dns check          # does *.example.com resolve to this server?
printf %s "$PASSWORD" | portta auth bootstrap --url https://example.com \
  --allow-remote --name 'Ada Lovelace' --email you@example.com --password-stdin
portta doctor
```

Create the owner as soon as the name resolves and the certificate answers, and
before you share the address: until it exists, whoever reaches the panel first
can claim it at `/setup`. In this mode the panel has no loopback port, so the
command goes through its own `https` address (`--allow-remote` says that is
deliberate). `doctor` must pass with no failures: it checks DNS, the auth service
and the certificate. The first certificate can take a minute or two. Then open
`https://example.com` and sign in. Turn on two-factor authentication under
Settings, Security.

Prefer to let Portta create the wildcard record? With the token in `.env`:

```bash
portta dns setup --target 203.0.113.10 --dry-run   # shows the change
portta dns setup --target 203.0.113.10             # makes it, after you confirm
```

That creates only the `*.example.com` record. The `example.com` record from
step 2 stays yours to create.

## 7. Teach your agents

```bash
portta agents install
```

It writes an instruction, a session hook and three skills for Claude Code,
Codex, OpenCode and Pi, whichever are on this machine. Codex asks you to approve
the hook the first time: open `/hooks` in a session and approve it. Check with
`portta agents status`.

## 8. Adopt a project

```bash
portta adopt /srv/shop                       # read the plan; it stops on public_exposure
portta adopt /srv/shop --protect web --public api
portta runtime up /srv/shop
portta urls
```

`--protect` generates a login and prints the password once; `--public` opens a
service to everybody. A service with no decision stays closed. Your Compose file
is never edited.

Adopting a project that already runs changes how it runs, so do it carefully:

1. Dump every database first, outside the host.
2. Run `portta adopt /srv/shop --dry-run` and read it. The Compose project name
   (the namespace) must not change: a different namespace means new volumes and
   an empty database.
3. Tools that used `127.0.0.1:3306` move to `portta db` or `portta access`.

Change a decision at any time, with no restart:

```bash
portta protect status
portta protect open shop-web.example.com
portta protect remove shop-web.example.com
```

## 9. Back up

```bash
portta backup
```

Schedule it (cron or a systemd timer) and copy the result off the host.

## Acceptance checklist

- [ ] `portta doctor` passes.
- [ ] The certificate is valid in a browser, for the panel and for a project.
- [ ] After a reboot, the gateway and projects come back.
- [ ] A protected site asks for a login and rejects a wrong password.
- [ ] A site nobody decided about is closed.
- [ ] A database is not reachable from the internet or from another project.
- [ ] The panel asks for a login and the owner has two-factor authentication.
- [ ] A link or login for a client works from your phone.
- [ ] Three projects run in parallel with different hostnames.
