# Configure DNS and TLS

The panel opens these controls directly at
[TLS settings](http://127.0.0.1:8081/settings/general/tls) and
[DNS settings](http://127.0.0.1:8081/settings/general/dns).

## Which profile, which TLS

Find where the browser is, read that row, and run the command in the TLS
column. The neighbouring questions keep their own tables, and this one only
points at them: which base a hostname gets is
[Project addresses](../concepts/addresses-and-access.md#project-addresses), how
the panel is reached is [The panel](../concepts/addresses-and-access.md#the-panel),
who may reach projects is
[Local, VPN, and public exposure](../concepts/addresses-and-access.md#local-vpn-and-public-exposure),
and what each ACME challenge asks of you is
[Two challenges](#two-challenges-and-which-one-you-want) below.

| Profile | Precondition | Resulting URL | TLS mechanism | How it fails | How to recover |
|---|---|---|---|---|---|
| **Loopback**, the machine you sit at | Nothing: the `local` profile, `*.localhost` and Traefik on `127.0.0.1` are the defaults | `http://demo-shop-web.localhost` | None, and that is the right default. For a secure context, the local CA: `portta tls init`, then the command `portta tls trust` prints | A name a Linux tool cannot resolve; a browser warning while the CA is not trusted | `portta doctor` names the resolver, see [How `.localhost` resolves](local-development.md#how-localhost-resolves); `portta tls trust` |
| **LAN**, a phone or a second computer on the same network | Traefik bound to the LAN address, and an `sslip.io` name for it ([the commands](#lan-and-tailnet-the-local-ca)) | `http://demo-shop-web.192-168-1-10.sslip.io` | None, or the local CA trusted on **every device**: `portta tls init` issues `*.192-168-1-10.sslip.io`. No ACME challenge can serve this name | The address changes with DHCP and every hostname with it; a router with DNS rebinding protection drops the answer; with the CA on, a device that has not trusted it gets a warning on every hostname, and `:80` redirects there | A DHCP reservation. After a new address, set the name again and run `portta tls init` again: the CA is kept, only the wildcard is reissued. `portta doctor` names the bind and what the name resolves to |
| **VPN / tailnet**, your own devices anywhere | Tailscale on the host and on each device. This machine: bind to the tailnet address, the same commands as LAN. A VPS: the `remote-private` profile ([Choose remote access](remote-development.md)) | `http://demo-shop-web.100-x-y-z.sslip.io`, or `https://demo-shop-web.vpn.dev.example.com` with a domain you own | An `sslip.io` name on the `local` profile: the local CA, trusted on every device, as for LAN. A domain you own on `remote-private`: ACME DNS-01 with the wildcard pointed at the tailnet address ([Remote](#remote-a-wildcard-record-and-dns-01)), a publicly trusted certificate no device has to be taught | No tailnet address when Tailscale came up after Docker; `tls.acme.credential` fails without `CF_DNS_API_TOKEN`; the CA warning on a device that has not trusted it | `portta up local` again; set the credential and run `portta doctor`; trust the CA on that device |
| **Tunnel / Internet**, anyone | A domain you own. Through a tunnel: `portta tunnel setup --zone example.com --token-file ./token.txt`, one proxied wildcard CNAME, `portta tunnel enable` ([Publish through Cloudflare Tunnel](cloudflare-tunnel.md)). On an open port: the wildcard at the public address, `portta dns setup --target <ip>`, then `portta public enable` ([Enable public access](public-access.md)) | `https://demo-shop-web.example.com` | Through a tunnel: Cloudflare's edge certificate; the gateway keeps `TLS_ENABLED=false` and the connector reaches Traefik over `http://traefik:80`. On an open port: ACME, DNS-01 for one wildcard or HTTP-01 per hostname | Tunnel: `530` means no connector, `502` means Traefik is down. Open port: no certificate is issued, almost always the DNS credential; HTTP-01 fails while Traefik is not on `0.0.0.0`; rate limited on production | `portta tunnel status` and `portta tunnel logs`; `portta doctor` (the `tls.acme.*` checks) and [Troubleshooting](#troubleshooting); [staging first](#use-staging-first) |

### LAN and tailnet: the local CA

Neither ACME challenge can serve these names. DNS-01 needs a credential for a
domain you control, and `192-168-1-10.sslip.io` is not yours. HTTP-01 needs
`:80` reachable from the internet, which is exactly what a LAN or tailnet bind
avoids. What is left is the CA described under [Local](#local-neither-is-needed),
issued for the `sslip.io` base instead of `*.localhost`. It is wired on the
`local` profile only: on a remote profile, TLS means ACME.

With `192.168.1.10` standing for this machine's LAN address or its tailnet
address (`100.x.y.z`):

```bash
portta config set gateway.domain 192-168-1-10.sslip.io --no-apply
portta config set domain.mode custom --no-apply
portta config set gateway.bindAddress 192.168.1.10
portta tls init
portta tls trust
```

`tls init` writes the CA and a wildcard for `*.192-168-1-10.sslip.io` to
`config/tls/`, turns TLS on in `.env`, and prints the trust command for this
machine. The trade-offs of the bind itself, the same with or without TLS, are
in [Open a project from another device](local-development.md#open-a-project-from-another-device).

**The cost is every other device.** The certificate is signed by a CA only this
machine knows, so each device that opens a hostname has to be taught to trust
`config/tls/portta-ca.crt` first, and the gateway cannot do that for you:

- A laptop or desktop: copy the file over and run the command `portta tls trust`
  prints for that operating system. Firefox needs its own import.
- An iPhone or iPad: send the file to the device, install it as a profile, then
  enable it under Certificate Trust Settings. Two steps in two places, repeated
  per device.
- Android: the browser accepts a CA installed under the security settings; most
  apps ignore a user-installed CA unless the app opted in.
- A managed work device may not allow a user-installed CA at all.

Until a device has done that, every hostname shows a certificate warning there,
and `:80` redirects to `:443`, so turning the CA on takes plain HTTP away from
that device too. `portta doctor` reports the mode as `tls.local` and does not
know which devices trust the CA; `portta tls status` shows which names the
certificate covers.

**Plain HTTP is the reasonable choice** when the other device only needs to
open the page: a phone checking a layout, a colleague's laptop on a home
network, anything that needs no Secure cookie, service worker or WebAuthn.
Nothing there gets better with a certificate a private CA signs, and the trust
step is paid on every device. Choose the CA when a secure context is required
on that device. When several devices, or any phone, need HTTPS, choose a domain
you own with ACME DNS-01 on `remote-private` ([Remote](#remote-a-wildcard-record-and-dns-01)):
that certificate is publicly trusted, and no device has to be taught anything.

## Local: neither is needed

`*.localhost` resolves to loopback by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)
with no DNS record and no configuration, and plain HTTP is the right default
for local development. What implements that on macOS and on each kind of
Linux host is in
[How `.localhost` resolves](local-development.md#how-localhost-resolves).
A hostname opened from another device, over the LAN or a tailnet, is neither
local nor remote in this sense; [the matrix](#which-profile-which-tls) above
covers it.

A different local base, such as `*.portta.test`, needs something to resolve it:
a DNS container, dnsmasq or a public record. See
[Use a custom local domain](local-domains.md).

Local HTTPS is available when you need a secure context: Secure cookies,
service workers, WebAuthn.

```bash
portta tls init
```

That issues a local CA and a wildcard certificate for the configured base
(`*.localhost` by default) inside the toolbox container (the host needs no
`openssl`), writes them to `config/tls/`, which is git-ignored, and hands them
to Traefik through the file provider. After changing the base domain, run it
again: the CA is reused and only the wildcard is reissued.

Trusting the CA writes to your operating system's trust store, so the gateway
**prints the command and lets you run it** rather than doing it for you:

```bash
portta tls trust      # shows the command for your platform
portta tls untrust    # and how to undo it
```

Firefox keeps its own store and needs a separate import.

## Remote: a wildcard record and DNS-01

One wildcard record covers every project and every worktree, forever:

```text
A    *.dev.example.com        203.0.113.10     ; public
A    *.vpn.dev.example.com    100.x.y.z        ; private, tailnet address
```

Pointing a **public DNS name at a private tailnet address** is intentional and
safe: the name is public, the address is only routable inside your tailnet.
Keep such a record DNS-only, never proxied. A tailnet-only gateway with an
`sslip.io` name instead of a domain is the
[LAN and tailnet](#lan-and-tailnet-the-local-ca) case above.

```bash
portta dns check                          # does the wildcard point here?
portta dns setup --target 203.0.113.10 --dry-run  # show the record to create
portta dns setup --target 203.0.113.10            # create it, via Cloudflare
```

`dns check` queries a name that can only match the wildcard, so a stray A
record on the apex cannot make a broken wildcard look healthy.

## Two challenges, and which one you want

`ACME_CHALLENGE` picks one. They differ in what they ask of you, not in the
certificate a browser ends up trusting.

| | `dns` (default) | `http` |
|---|---|---|
| Certificates | one wildcard, `*.example.com` | one per hostname |
| Needs | a DNS provider credential | `:80` reachable from the internet |
| Private / VPN-only gateway | works | impossible |
| A hostname nothing is serving yet | already has HTTPS | gets none until a router exists |
| First request to a new service | immediate | waits a second or two for issuance |
| Let's Encrypt limits | one certificate covers everything | each name counts against the weekly limit for the domain |

### `dns`: one wildcard

**HTTP-01 cannot issue a wildcard.** That is why this is the default: Portta
routes `<project>-<service>.<domain>`, and a wildcard means every one of those
names works over HTTPS the moment it exists.

DNS-01 has a second advantage: the ACME server never needs to reach your host,
only to see a TXT record. So a private, VPN-only gateway gets a real,
publicly-trusted certificate without exposing anything.

```env
TLS_ENABLED=true
TLS_MODE=acme
ACME_CHALLENGE=dns
ACME_EMAIL=you@example.com
ACME_DNS_PROVIDER=cloudflare
ACME_DNS_RESOLVERS=1.1.1.1:53,8.8.8.8:53
CF_DNS_API_TOKEN=...    # scoped: Zone:DNS:Edit + Zone:Zone:Read
```

### `http`: no credential

A public gateway on a public IP can skip the credential entirely. Traefik asks
for a certificate the first time a router is created for a hostname, Let's
Encrypt fetches a token from this host over `:80`, and the certificate arrives.
This is what a platform that only ever publishes on public names does, and it
is why those platforms ask you for nothing but an A record.

```env
TLS_ENABLED=true
TLS_MODE=acme
ACME_CHALLENGE=http
ACME_EMAIL=you@example.com
```

`:80` must be reachable from the internet — `portta public enable`, and nothing
in front of it that refuses `/.well-known/acme-challenge/`. `portta doctor`
checks both the challenge and its one prerequisite.

Traefik terminates TLS at the entrypoint, so a project gets HTTPS without a
single certificate label of its own:

```text
entryPoints.websecure.http.tls.certResolver = letsencrypt
entryPoints.websecure.http.tls.domains[0].main = dev.example.com
entryPoints.websecure.http.tls.domains[0].sans = *.dev.example.com
```

## Use staging first

Let's Encrypt's rate limits are unforgiving and a misconfigured DNS-01 will
burn through them quickly.

```env
ACME_CA_SERVER=https://acme-staging-v02.api.letsencrypt.org/directory
```

Certificates will not be trusted, which is the point: you are testing
issuance. Switch to production and delete `state/traefik/acme/acme.json` to
force a fresh issuance once it works.

## Other providers

`ACME_DNS_PROVIDER` accepts any provider name lego supports (Route 53,
DigitalOcean, Gandi, deSEC and many more). Cloudflare is the reference
implementation because it is common and its scoped tokens are good, not because
the gateway depends on it.

For another provider, set the provider name and pass its credentials to Traefik
as environment variables, following that provider's lego documentation. The
`CF_DNS_API_TOKEN` line in `docker/compose/profiles/remote-tls-dns.yaml` is the template.

## The ACME store

`state/traefik/acme/acme.json` holds the account key and every certificate. It
is created `0600`, git-ignored, and `doctor` fails if the permissions loosen.
Back it up with `state/` and `.env`; losing it means re-issuing.

## Checking

```bash
portta tls status
portta dns check
docker logs portta-traefik-1 2>&1 | grep -i acme
```

## Troubleshooting

**No certificate is issued.** Almost always the DNS credentials. Traefik logs
the provider's error. Confirm the token has `Zone:DNS:Edit` on the right zone.

**"unable to generate a certificate for the domains".** The resolver could not
see the TXT record yet. Check `ACME_DNS_RESOLVERS`, and that the zone is not
served by a provider other than the one holding your token.

**Rate limited.** You were on production. Switch to staging, get it working,
then switch back.

**The certificate is right but browsers still complain locally.** The local CA
is not trusted yet. Run `portta tls trust`.
