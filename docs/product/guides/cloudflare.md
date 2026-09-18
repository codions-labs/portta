# Configure Cloudflare DNS

Open the gateway's [DNS settings](http://127.0.0.1:8081/settings/general/dns) to edit
the managed Cloudflare keys from the panel.

Cloudflare is the **reference** DNS provider, not a requirement. Everything the
gateway does works with any provider; Cloudflare just gets automation.

## Token, never the Global API Key

Create a scoped API Token:

1. Cloudflare dashboard → My Profile → API Tokens → Create Token
2. Start from *Edit zone DNS*
3. Permissions: **Zone → DNS → Edit**
4. Zone Resources: **Include → Specific zone → your zone**
5. Optionally restrict by client IP and set an expiry

```env
CLOUDFLARE_ENABLED=true
CF_DNS_API_TOKEN=...
CLOUDFLARE_ZONE=example.com
```

The Global API Key authenticates **everything in your account**, cannot be
scoped, and cannot be rotated without breaking every other use. It is never a
recommendation here.

The token is sent only in an `Authorization` header, never on a command line
where `ps` would show it, never printed, and never logged. `portta
inspect` shows `<set>` or `<unset>`.

## What it is used for

**DNS-01 certificate challenges.** Traefik passes `CF_DNS_API_TOKEN` to lego,
which creates and removes a TXT record during issuance. This is the part that
makes wildcard certificates possible.

**Wildcard record management**, through `portta dns`:

```bash
portta dns status                                 # configuration, without secrets
portta dns check                                  # does the wildcard point here?
portta dns setup --target 203.0.113.10 --dry-run  # show the change that is needed
portta dns setup --target 203.0.113.10            # make it, after confirming
```

`setup` requires `--target <ip>` and never writes without a configured token;
pass `--dry-run` to print the plan without writing, and it asks before changing
an existing record.

## Keep the record DNS-only

Records the gateway creates use `proxied: false`, and yours should too.

Cloudflare's proxy terminates TLS and re-originates the connection. That breaks
the private profile completely, since the record points at a tailnet address
Cloudflare cannot reach, and for the public profile it means Cloudflare, not
Traefik, decides what your certificate is.

Turn the orange cloud off for `*.dev.example.com`.

## Without Cloudflare

Leave `CLOUDFLARE_ENABLED=false`. `dns setup` then prints the record for you to
create by hand, and `dns check` still verifies it.

For certificates, set `ACME_DNS_PROVIDER` to your provider's lego name and pass
its credentials to Traefik as environment variables. The `CF_DNS_API_TOKEN`
line in `docker/compose/profiles/remote-tls-dns.yaml` is the template to copy.

## Troubleshooting

**"Cloudflare did not return a zone named ..."** means the token lacks access
to that zone, or `CLOUDFLARE_ZONE` is the domain rather than the zone (for
`dev.example.com` the zone is usually `example.com`).

**Certificates fail while `dns check` passes.** The token needs
`Zone:DNS:Edit`, not just `Zone:DNS:Read`. Issuance writes a TXT record.

**The record exists but nothing connects.** It is probably proxied. Turn the
orange cloud off.
