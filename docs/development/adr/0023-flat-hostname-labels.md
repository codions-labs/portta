# 0023. Generated hostnames separate components with -- in one DNS label

**Status:** Accepted; extends [0005](0005-hostname-convention.md)

## Context

The namespace and service labels that Compose injects identify a service on the
host. Joining those fields with a single hyphen loses their boundaries:
namespace `a-b`, service `c` and namespace `a`, service `b-c` both become
`a-b-c`. A branch, pull request or preview can also add an independent context.

Putting each field in a separate DNS label makes those boundaries visible, but
changes certificate requirements. A wildcard certificate for `*.example.com`
covers `shop--web--pr-42.example.com`, not `web.pr-42.shop.example.com`.
[RFC 9525 section 6.3](https://www.rfc-editor.org/rfc/rfc9525.html#section-6.3)
limits the wildcard to one complete label. DNS wildcard matching has different
rules; it must not be confused with certificate matching.

## Decision

**Every generated service hostname uses one label and `--` between fields:**

```text
<namespace>--<service>[--<context>].<domain>

storefront--web.example.com
storefront--web--pr-42.example.com
shop-feature-login--api.example.com
```

The namespace is the existing `COMPOSE_PROJECT_NAME`, treated as an opaque
identity. It may already contain the branch. A context is appended only when
it is an independent field, never to repeat a branch already in the namespace.
Internal ports remain upstream configuration rather than mandatory URL fields.

Core owns normalization, validation and fitting. Components use lowercase
ASCII letters, digits and single hyphens, so they cannot introduce the `--`
separator. Required components that normalize to an empty string, and names
containing control characters, are refused.

The first label must not contain `--` in positions three and four, reserved by
IDNA. A generated label such as `go--api` is prefixed with `env-` to avoid that
position. See [RFC 5890 section 2.3.1](https://www.rfc-editor.org/rfc/rfc5890.html#section-2.3.1).

A DNS label is limited to 63 octets and the complete hostname to 253 characters
without its trailing dot. Because generated labels are ASCII, their character
and octet counts agree. A long label is shortened with an eight-character
hexadecimal SHA-256 digest of its complete original identity, before
normalization or truncation. Field boundaries remain part of that identity.
A digest reduces accidental collisions; callers must still refuse conflicting
routes rather than treating it as a uniqueness or authorization guarantee.

Managed overlays carry the canonical label in `portta.hostname`, without a
domain. Traefik consumes that label and Core uses the same value for inventory
and endpoints. The Docker provider's default rule derives the same convention
when the label is absent, including validation and fitting. Display and routing
must agree for short names, contexts, normalization and names near the DNS
limit. Metadata, not a split of the fitted hostname, establishes ownership.

Temporary links use the same boundaries:

```text
<namespace>--<service>--share-<id>.<domain>
```

Fitting reserves room for the share identifier and suffix. Router and service
identifiers inside Traefik keep their existing names: they are not hostnames.
TCP templates use the same canonical hostname while keeping their transport
ports and TLS requirements.

## Consequences

One wildcard certificate can cover all generated names under a base domain.
This does not issue a certificate, enable HTTPS, publish a service or grant
access. Those remain separate configuration and authorization decisions.

The readable label is longer, and abbreviation can remove readable fields.
Normalization can also converge distinct inputs before a label needs fitting.
Collision checks and metadata remain necessary; a hostname is not a reversible
serialization of the environment.

There is one runtime convention. The 0.7.0 migration moves existing generated
URLs and access decisions to it, with no old-format routing fallback, redirects
or compatibility aliases. Custom domains remain explicit choices. Existing
Compose namespaces, containers, networks and volumes are not renamed as part
of this URL migration; preserving those identities preserves the data paths.
The migration preserves credential hashes and access policy, but sessions tied
to an old hostname must authenticate again at the new one.

The retired format is read only by the dedicated migration operation. New
namespaces are generated from the original base, branch and workspace identity
with a digest, while existing namespaces are never passed through that generator
again. See [Update Portta](../../product/guides/update.md) for the cutover order.
