# Publish through Cloudflare Tunnel

Publish your services over HTTPS **without opening a port**, from a machine that
has no public address at all.

```text
your laptop / home lab / VPS              the internet
                                              |
  container  <-  Traefik  <-  cloudflared  ->  Cloudflare edge  ->  visitor
                                  |
                          outbound only. No inbound port, ever.
```

This is optional. Portta works without it, and enabling it changes nothing about
which services are reachable — that stays a separate, per-service decision.

## Why you might want it

| You have | Without a tunnel | With a tunnel |
|---|---|---|
| a laptop | `*.localhost`, and nothing anyone else can open | a real HTTPS URL you can send someone |
| a home lab behind NAT | port forwarding on the router, if it is even possible | nothing to forward |
| a connection behind CGNAT | **impossible**: there is no address to forward to | works |
| a VPS with a public address | ports 80 and 443 open to the world | ports stay closed |
| no domain | `sslip.io` over plain HTTP | HTTPS on your own domain |

The one that is not a trade-off: **behind CGNAT there is no alternative.** Your
connection has no public address to point a DNS record at.

## Tunnel, Proxy and Access are three different things

They are often confused, and they solve different problems. You can use any
combination.

**Cloudflare Proxy** (the orange cloud) sits in front of a server that already
has a public address. Traffic goes to Cloudflare, then to your address. You still
need an open port.

**Cloudflare Tunnel** replaces the address entirely. `cloudflared` runs on your
machine and dials *out* to Cloudflare, and traffic comes back down that
connection. Nothing needs to reach you.

**Cloudflare Access** is authentication at the edge. It decides *who* may reach
a hostname, before the request ever gets to you. It is not a way in; it is a lock
on a door that already exists.

Portta treats them exactly that way: the tunnel is transport, Access is an
optional edge policy, and Portta ForwardAuth remains an independent origin-side
login. Neither mechanism depends on the other.

## What you need

- A domain on Cloudflare. Any plan, including the free one.
- Docker, which you already have.

That is all. You do **not** need: a public IP address, an open port, a static
address, a certificate, or a Cloudflare API token.

## Setting it up

### 1. Create the tunnel

Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Networks** →
**Tunnels** → **Create a tunnel** → **Cloudflared**.

Give it a name (`portta` is a fine one) and select **Create**.

### 2. Copy the token

The next screen shows an install command for your platform. It looks like:

```bash
docker run cloudflare/cloudflared:latest tunnel --no-autoupdate run --token eyJhIjoiNWFiNGU5Z...
```

**Do not run it.** Copy only the long `eyJ...` string at the end — that is the
token. It is the whole credential, so treat it like a password.

You can skip the dashboard's "public hostname" step entirely. Portta configures
routing itself, which is what lets one tunnel serve every project you will ever
create.

### 3. Give it to Portta

From the command line, where the token is read from a file or a hidden prompt
rather than an argument:

```bash
portta tunnel setup --zone example.com --token-file ./token.txt
portta tunnel setup --zone example.com     # prompts, input hidden
```

There is deliberately no `--token` flag. An argument is visible in `ps` to every
user on the machine, and in your shell history.

### 4. Point the domain at the tunnel

`setup` prints the one record you need:

```text
  Type    CNAME
  Name    *.example.com
  Target  6ff42ae2-765d-4adf-8112-31c55c1551ef.cfargotunnel.com
  Proxy   on (orange cloud)
```

Create it in **DNS → Records**. This is the only manual Cloudflare step, and it
is done **once**: the wildcard covers every project you create afterwards.

Cloudflare proxies wildcard records on every plan, and Universal SSL covers
`*.example.com` for free.

> The tunnel UUID in that target is not a secret. `cfargotunnel.com` only accepts
> records from the account that owns the tunnel.

### 5. Start it

```bash
portta tunnel enable
portta tunnel test      # confirms traffic is flowing
```

`test` asks the internet for a hostname nothing is routed to. Traefik answering
`404` is success: it proves the whole path — edge, connector, proxy — works.

## Exposing a service

Once the tunnel is connected, every project gets a hostname automatically:

```text
ecommerce-web.example.com
ecommerce-api.example.com
ecommerce-mail.example.com
```

and, where a branch or pull request needs its own environment, its own
Compose project namespace carries the difference:

```text
ecommerce-develop-web.example.com
ecommerce-pr-123-web.example.com
```

**Nothing needs to be created at Cloudflare for any of these.** Starting a
container is the whole operation. The connector carries one wildcard rule, and
Traefik routes by hostname exactly as it always has.

Everything sits in a single DNS label on purpose. `*.example.com` covers one
level, and so does the free certificate; `web.ecommerce.example.com` would need
Cloudflare's paid Advanced Certificate Manager. See
[ADR 0023](../../development/adr/0023-flat-hostname-labels.md).

## Turning it off

Stop the connector:

```bash
portta tunnel disable            # stops the connector, keeps the configuration
portta tunnel disable --forget   # also deletes the local credential
```

Either way, **nothing in your Cloudflare account is touched**. The tunnel, the
DNS record and any Access policy stay exactly as they are, and Portta will never
delete them for you. Re-enabling after a plain `disable` needs no token.

## Token security

The token is the credential. Anyone who has it can run your tunnel.

What Portta does with it:

- decodes it once into `state/cloudflared/credentials.json`, mode `0600`, in a
  directory that is mode `0700`
- **never** writes it to `.env`, which is the file the panel edits and you read
- **never** returns it from any API endpoint, in any state
- **never** puts it in a log line, a diagnostic, or an error message
- **never** passes it as a command-line argument, where `ps` would show it

`portta tunnel status` and `GET /api/tunnel` report whether a tunnel is
configured, never the token. Running `portta tunnel setup` again replaces it.
Nothing can show you the value again. If you lose it, create a new token in
the dashboard — the old one keeps working until you rotate it there.

Portta holds no Cloudflare API token and cannot change your account.

## Troubleshooting

Each failure has a distinct signature, which is why `portta tunnel status`,
`test` and `logs` name them separately rather than saying "not working".

**`530` from Cloudflare, "Tunnel error".** Cloudflare has no connector for this
tunnel. The connector is not running, or cannot reach the edge.

```bash
portta tunnel status
portta tunnel logs
```

**`502` from Cloudflare.** The connector is connected but could not reach your
service. Traefik is down, or the container is stopped.

```bash
portta status
```

**Traefik's own `404`.** The tunnel works perfectly and nothing is routed at that
hostname. Check the service has `traefik.enable=true` and is on the shared
network.

**Panel says "Authentication error".** Cloudflare rejected the token. The tunnel
was probably deleted, or the token belongs to a different account. Create a new
tunnel and paste the new token.

**The connector will not start.** Check that outbound traffic is allowed: it
dials Cloudflare on `7844/udp` and falls back to `443/tcp`. A firewall that
blocks outbound UDP is the usual cause.

**The hostname does not resolve at all.**

```bash
dig +short ecommerce-web.example.com
```

Nothing back means the wildcard CNAME is missing, or is not proxied. It must be
the orange cloud.

**It worked and then stopped after a reboot.** The connector has
`restart: unless-stopped`, so it returns with Docker. If Docker itself is not
enabled at boot, nothing comes back:

```bash
sudo systemctl enable docker
```

## Home lab, NAT and CGNAT

This is the case the feature exists for, and there is nothing extra to do. The
machine needs outbound internet and nothing else — no router configuration, no
port forwarding, no static address, no dynamic DNS.

On CGNAT (common with mobile broadband and some fibre providers) your connection
has no public address at all, and a tunnel is the only thing that can work.

A laptop is the same story. The tunnel follows the machine: move between
networks and the connector reconnects on its own.

## What this does not do

**It does not decide what is published.** The connector carries a wildcard to
Traefik, and Traefik still routes only services that opted in. Enabling a tunnel
publishes nothing by itself.

**It does not replace publishing a port.** A VPS with a public address and open
ports is faster (traffic goes straight to you) and depends on nobody. Both stay
supported; see [ADR 0025](../../development/adr/0025-cloudflare-tunnel.md) for the comparison.

**The apex is not included.** `*.example.com` does not match `example.com`. Pass
`--apex` at setup if the bare domain should reach the gateway too.

**Traffic goes through Cloudflare.** That is the deal: they terminate TLS and see
the requests. If that is not acceptable, use Tailscale for private access
([Expose the gateway through Tailscale](tailscale.md)) or publish a port directly.

## See also

- [ADR 0025](../../development/adr/0025-cloudflare-tunnel.md) — the architecture, and what was
  measured to arrive at it
- [ADR 0023](../../development/adr/0023-flat-hostname-labels.md) — why hostnames are one label
- [Configure Cloudflare DNS](cloudflare.md) — Cloudflare as a DNS provider, for certificates
- [Security](../concepts/security.md) — what each exposure level means
