# 0023. A service's whole name lives in one DNS label

**Status:** Accepted; see [0005](0005-hostname-convention.md)

## Context

[ADR 0005](0005-hostname-convention.md) derives every project hostname from the
labels Compose already injects, as `<project>-<service>.<base>`. Two things it
did not have to answer come up as soon as a name needs more than two parts.

**A name may need a third component.** A branch, a pull request, a preview
environment — anything that distinguishes one run of the same service from
another. `<project>-<service>` has nowhere to put it.

**A single `-` cannot be read back.** `slug` replaces every run of
non-alphanumerics with one `-`, so `storefront-web` could be project
`storefront` service `web`, or project `storefront-web` with no service at all.
The gateway never needs to parse a hostname it produced, so this costs
nothing. Anything that reconciles routes, or that maps a hostname back to a
container, cannot rely on the split.

The obvious answer — more levels, `web.storefront.example.com` — was measured
before being rejected.

### What a second level actually costs

Cloudflare's Universal SSL covers **the apex and first-level subdomains only**.
`web.storefront.example.com` is a second level and is not covered. Serving it
over HTTPS requires Advanced Certificate Manager, a **paid add-on on every
plan**, or Total TLS, which is part of the same add-on. Cloudflare's own tunnel
troubleshooting says so directly: a multi-level subdomain shows
`This site can't provide a secure connection` until an advanced certificate is
ordered.

The same limit applies with no Cloudflare in sight. A wildcard certificate
covers one level, by the standard, so `*.1-2-3-4.sslip.io` cannot cover
`web.demo.1-2-3-4.sslip.io` either. Multi-level naming would mean a certificate
per project, on a host that by design has no DNS API to answer a DNS-01
challenge with. Browsers add nothing to that: a single label is what a
wildcard, a cookie scope and a CORS origin all agree on.

So the choice is not "flat or nested". It is "flat, or ask every operator to buy
a certificate add-on before they can name a second project".

## Decision

**A service's whole name lives in one DNS label, `<project>-<service>`, and
a third component, when there is one, joins it with `--`.**

```
storefront-web.example.com
storefront-web--pr-42.example.com
shop-api--preview-7.example.com
```

The Traefik default rule in `docker/compose/compose.yaml` produces the
`<project>-<service>` label from the Compose labels at container start, and
`hostLabel` in `packages/core/src/hostname.ts` derives the same name for
display, so the panel cannot print one name while the gateway serves another.
A context — a branch, a pull request, a preview — is appended with the
`--` separator, which works precisely because `slug` collapses runs of `-`: no
component can ever contain two in a row, so the boundary before the context is
unambiguous.

Length is bounded by the DNS, not by us: a label may not exceed 63 octets and a
whole name 253. `fitLabel` trims an over-long label and appends a short digest
**of the original**, so two long branch names cannot truncate onto each other
and silently route to whichever container Traefik matched first.

## Consequences

**One wildcard covers everything.** `*.example.com` — the record the operator
already has, on the certificate Cloudflare already issues for free — covers
every project this gateway will ever route, including ones that do not exist
yet. That is what makes both the automatic domains and the Cloudflare Tunnel
in [ADR 0025](0025-cloudflare-tunnel.md) work without a per-service record.

**Names get longer and less pretty.** `storefront-web--feature-auth-login` is
a mouthful next to `web.login.storefront.example.com`. That is the trade, and it
buys a free certificate and a name that can be served under one wildcard.

**A very long branch produces a digest.** `feature/…` names that exceed the
label limit end in six characters nobody chose. The alternative was two branches
sharing a hostname, which is worse in a way that is much harder to notice.

**One style to keep in step.** The Traefik rule and `hostLabel` must produce
the same label for the same Compose project and service, and a test covers
both; a second style would double that surface, and there should not be one.
