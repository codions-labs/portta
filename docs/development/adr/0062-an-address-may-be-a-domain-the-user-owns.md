# 0062. An address may be a domain the user owns

**Status:** Accepted; see [0011](0011-bounded-traefik-write-surface.md), [0023](0023-flat-hostname-labels.md)

## Context

A service answered only on the hostname Portta derives under its own domain. A user who owns a
domain, at Cloudflare or Registro.br, and points it at the server had no way to say "this service
is `loja.example.com.br`". The panel already had a hostname alias, but it refused any name outside
the domains the gateway serves and allowed one per service.

## Decision

The alias is extended, not replaced. A service may have up to ten additional hostnames, and a
hostname outside the served domains is accepted as a **custom domain**. The derived hostname keeps
answering, as before.

- **Stored** under the `aliases` setting (a list); the first version's single `alias` is still read
  and is dropped when a list is written. The generated `portta-aliases.yaml` stays the source for
  routing, and each entry carries `custom` and, when needed, the certificate resolver.
- **Refused** before any write when no certificate authority could issue for the name: an IP
  address, a name with no dot, `.local` and `.internal`. Everything else the alias refused stays.
- **Certificates:** on a gateway issuing over DNS-01, the wildcard and the DNS provider do not cover
  the user's domain, so its router names a second resolver, `letsencrypthttp`, which issues over
  HTTP-01. Under HTTP-01 the default resolver already does, and without TLS there is nothing to issue.
- **One list of addresses.** The panel decorates each service's `urls` with its aliases, and the
  CLI builds its routes from the same file, marking the address to report as `primary`: a custom
  domain first, then the derived hostname, then a nickname. `portta urls`, `portta envs show`, the
  agent context and the doctor all follow it.

## Consequences

- A custom domain needs `:80` reachable and an `A` record before it gets HTTPS; the panel shows the
  record to create and the doctor warns while the name does not resolve here.
- Let's Encrypt's per-domain limits apply to the user's own domain.
- A private gateway cannot issue for a public domain this way.
- The CLI cannot add or remove an address: it has no authenticated client for the panel API, and
  writing the file alone would leave the database row behind. Addresses are set in the panel.
