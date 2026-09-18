# Choose remote access

The same gateway, the same commands, one host away. Two modes:

| Profile | Who can reach it | Typical use |
|---|---|---|
| `remote-private` | your tailnet only | the default and the recommendation |
| `remote-public` | the internet | demos, webhooks, external testing (opt-in) |

> **Verification status.** The local profile is exercised end to end by CI on
> every change. The remote profiles are validated by configuration tests (every
> profile renders, the private profile never binds `0.0.0.0`), but the tailnet
> and ACME paths need real credentials and are **not** exercised automatically.
> Treat the checklist at the end of this page as required, not optional.

## Prerequisites

- Ubuntu 24.04 (what CI tests) or 22.04, `amd64` or `arm64`
- Docker Engine 24+ and the Compose v2 plugin (2.24.4 or newer)
- SSH access with a key
- A Tailscale account for `remote-private`
- A domain you control for TLS

## Preparing the host

Two ways. Over SSH by hand, the same install as anywhere else:

```bash
ssh deploy@vps.example.com 'npm install -g @codions/portta && portta setup --profile remote-private --yes'
```

Or from your workstation, `portta remote bootstrap`, which prepares the host
from a Git checkout of the repository; see
[Prepare a remote host](remote-bootstrap.md). Either way, secrets are never
copied from your machine: set `TS_AUTHKEY`, `ACME_EMAIL` and
`CF_DNS_API_TOKEN` in the host's `.env`. Then drive it from anywhere:

```bash
portta remote status deploy@vps.example.com
portta remote doctor deploy@vps.example.com
portta remote urls   deploy@vps.example.com
```

## Private mode

```env
PORTTA_PROFILE=remote-private
TAILSCALE_ENABLED=true
TS_AUTHKEY=tskey-auth-...
PRIVATE_DOMAIN=vpn.dev.example.com
TLS_ENABLED=true
TLS_MODE=acme
ACME_EMAIL=you@example.com
CLOUDFLARE_ENABLED=true
CF_DNS_API_TOKEN=...
CLOUDFLARE_ZONE=example.com
```

```bash
portta up remote-private
portta dns setup --target 203.0.113.10
portta doctor
```

Traefik runs **inside the Tailscale container's network namespace**, so it
listens on the node's tailnet address and publishes nothing on the VPS's public
interface. `remote-private` refuses to bind `0.0.0.0` at all.

Details and the alternative host-native setup: [Expose the gateway through Tailscale](tailscale.md).

Not using Tailscale? Leave `TAILSCALE_ENABLED=false` and point
`PORTTA_BIND_ADDRESS` at your VPN interface's address. The profile still
refuses `0.0.0.0`.

## Public mode

Off by default. Enabling it is a deliberate act:

```bash
portta public enable
```

It resolves the public domain, refuses if none can be found or a TCP
entrypoint is active, then asks a single confirmation naming that domain. See
[Enable public access](public-access.md).

## TLS

Wildcard certificates require ACME **DNS-01**, because HTTP-01 cannot issue
them. That also means a private domain works: the ACME server never has to reach your
host, only see the DNS record. See [Configure DNS and TLS](dns-and-tls.md).

## Firewall

The gateway never changes firewall rules. See [Configure firewall rules](firewall.md) for the
minimal UFW configuration for each profile.

```bash
portta network status
```

shows interfaces, the tailnet address, every published port and who owns it.

## Updating

```bash
portta update
```

Validates the Compose configuration **before** pulling, pulls the pinned images,
asks before recreating, and leaves `state/` untouched, including ACME
certificates and the Tailscale identity.

To take a new release as well, run `npm install -g @codions/portta && portta
setup` on the host, or `portta remote bootstrap` again for a host prepared
from a checkout ([Update Portta](update.md)).

## Backing up

`portta backup` writes one archive with `.env`, the state directory and a copy
of the panel database; see [Back up and restore the panel](backup-restore.md).

## Smoke checklist

Because the remote paths are not covered by automated tests, verify by hand
after the first deploy:

- [ ] `portta doctor` passes on the host
- [ ] `portta network status` shows no unexpected `0.0.0.0` bind
- [ ] `tailscale status` on the host shows the node connected
- [ ] the tailnet address is reachable from your workstation
- [ ] `portta dns check` resolves the wildcard
- [ ] a demo answers over HTTPS with a valid certificate
- [ ] from a machine **outside** the tailnet, the VPS's public IP does not answer on 80/443
- [ ] restarting the gateway leaves applications running
- [ ] rebooting the host brings the gateway back
