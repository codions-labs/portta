# Addresses and access

Portta asks three separate questions. The Settings pages follow the same split.
Mixing them is what makes a hostname look like a public URL, or a panel change
look like it published every project.

Open [Project addresses](http://127.0.0.1:8081/settings/general/project-domain),
[Project access](http://127.0.0.1:8081/settings/general/project-access), or
[Panel](http://127.0.0.1:8081/settings/general/panel) to edit the managed keys
from the panel.

## The three decisions

1. **What a service is called.** The base every project hostname is built on.
2. **Who can reach Traefik.** Whether that name answers on this machine, a VPN,
   or the internet.
3. **How the panel is reached.** Independent of the first two. Publishing the
   panel never publishes a project.

A name is not an exposure. `demo-shop-web.example.com` is only a name until something
is listening where that name resolves, and only a public name if Traefik is
bound to the internet on purpose.

## Project addresses

Portta derives every project hostname. It does not store one per service.

```text
<project>-<service>.<base>
```

A Compose project named `demo-shop` with services `web` and `api` becomes:

```text
demo-shop-web.localhost
demo-shop-api.localhost
```

One DNS label holds both parts, so a single wildcard (`*.example.com` or
`*.1-2-3-4.sslip.io`) covers every project. Nested names such as
`web.demo-shop.example.com` would sit below that wildcard.

The base is a mode, not a value you have to keep in sync:

| Mode | Base | When |
|---|---|---|
| This machine | `localhost` | You are sitting at the host |
| Automatic | `<ip-with-dashes>.sslip.io` (or `nip.io`) | A host with an address and no domain |
| Your own domain | the domain you type | You already have a wildcard |

Changing the mode re-labels every project at once. Who may open those names is
still Public access or VPN.

## Localhost

`.localhost` resolves to loopback with no DNS server and no `/etc/hosts` line.
It is the default, and it only works on this machine. A panel reached from
elsewhere must not advertise `*.localhost` as a clickable URL.

## Automatic domains

[sslip.io](https://sslip.io) and [nip.io](https://nip.io) answer for any name
that embeds an IPv4 address. No record, no account, no registration:

```text
demo-shop-web.203-0-113-10.sslip.io  →  203.0.113.10
```

The dashed form keeps the address in one label, so the project hostname stays
one level below the base. These names resolve from anywhere the address is
routable. They are still not public until Public access is turned on.

## Custom domain

A domain you own, with a wildcard `A` (or `AAAA`) record:

```text
*.dev.example.com  →  this host
```

Until that record exists, the names are formed correctly and nothing answers.

The domain does not have to be public. A base that resolves to `127.0.0.1` on
this machine, such as `portta.test` served by a local DNS container, is a
custom domain too; [Use a custom local domain](../guides/local-domains.md)
covers the options.
[DNS](#dns) can create the record through Cloudflare; it can also be created by
hand.

## Project access

[Project access](http://127.0.0.1:8081/settings/general/project-access) keeps
the reachability decision in one place. Choose this machine, the Tailscale VPN,
or the internet; the panel derives the matching gateway profile and bind
address instead of asking you to coordinate them by hand.

### Public access

[Project access](http://127.0.0.1:8081/settings/general/project-access) decides whether the internet
can reach Traefik on ports 80 and 443.

It changes **who can reach Traefik**. That is all.

It does not change the hostname formula. It does not publish a service that has
not set `traefik.enable=true`. It does not publish the panel, the Traefik
dashboard, or any datastore.

When project addresses already use a domain you own, that domain is the public
namespace unless you set a different one. When they use `localhost`, a public
domain is required: `localhost` is not reachable from the internet. When they
use an automatic domain, that name can be reused.

Turning this on is explicit. Changing a project domain or the panel URL never
turns it on.

See [Enable public access](../guides/public-access.md) for the CLI and what is never
published.

## Traefik

Traefik is the reverse proxy that receives every hostname and forwards it to
the matching container. The default rule is the formula above.

Its own dashboard is a separate process, published on loopback by the normal
host attachment (default `http://127.0.0.1:8080/dashboard/`). It has no login of
its own, so it is never routed on a domain. When Traefik shares the Tailscale
network namespace, that port can also be reached on the tailnet; the Settings
page calls this out explicitly.

See [Project access](http://127.0.0.1:8081/settings/general/project-access) for listen address
and ports, and [Traefik](http://127.0.0.1:8081/settings/general/traefik) for the
dashboard.

## TLS

Certificates for project hostnames. They are not assumed just because a domain
is set.

- Off: only HTTP is served.
- Local CA: a certificate you trust on this machine.
- Let’s Encrypt: ACME. DNS-01 issues one wildcard and needs a DNS credential.
  HTTP-01 issues one certificate per hostname and needs port 80 reachable from
  the internet.

Automatic domains do not get a wildcard from Let’s Encrypt DNS-01. A hostname
you own does, once [DNS](#dns) can answer the challenge.

Which mechanism fits loopback, the LAN, a tailnet or the internet, and what
each costs, is one table in
[Which profile, which TLS](../guides/dns-and-tls.md#which-profile-which-tls).
See [Configure DNS and TLS](../guides/dns-and-tls.md).

## The panel

The panel process and the address you type in a browser are different things.

**Network** is the host-facing publication: port (default `8081`) and bind
(default `127.0.0.1`). In direct modes this publishes the panel container. In
public mode the same values belong to its dedicated Traefik entrypoint, and
`0.0.0.0` is only selected by that explicit public choice.

**Address** is how a browser reaches it:

| Choice | `PORTTA_WEB_EXPOSE` | Result | Sign-in |
|---|---|---|---|
| This machine only | `local` | `http://127.0.0.1:8081` | Optional |
| Directly on the tailnet | `tailscale` | this host's own tailnet address | Optional |
| Over the VPN | `vpn` | `PORTTA_WEB_HOST.<domain>`, routed by Traefik on `remote-private`; read-only unless `--writable` | Optional |
| On the panel port, from the internet | `public` | `http://<PORTTA_PANEL_ADVERTISED_HOST>:<port>`, Traefik's own `panel` entrypoint, not 80/443 | Required |
| On a hostname | `domain` | one hostname of the gateway's domain, routed by Traefik | Required |

The default is this machine. Choosing a hostname never publishes your projects.

Sign-in is optional exactly where the network has already decided who gets
through. Loopback answers this machine; a tailnet address answers a device
somebody enrolled and an ACL admits; the private name only resolves and only
routes inside the VPN. In those three the set of people who can reach the panel
is already an authenticated set, so `PORTTA_AUTH_MODE=disabled` is a choice
rather than an open door, and a single-operator installation reached over a
tailnet runs with no accounts and no `/setup`. The last two
rows answer whoever finds the address, and there the panel refuses to start
without `PORTTA_AUTH_MODE=required`.

The address choice does not settle one case: **this machine only** with a
**Network** bind that is not loopback offers the panel to the local network, and
"everyone on this Wi-Fi" is not an authenticated set. Turning the login off
there takes `PORTTA_AUTH_ALLOW_LAN=true` in `.env`; without it the panel refuses
to start and `portta doctor` fails rather than warns. Where Portta does accept a
panel with no login, `doctor` still warns and names the assumption, because "no
login" should never be invisible.

See [Configure authentication](../guides/authentication.md).

### Subdomain of the configured domain

You type only the label. The base is the one already configured for projects:

```text
[ portta ] .localhost
→ http://portta.localhost
```

### Custom panel domain

A hostname of your own, for example `portta.example.com`. It must resolve to
this server. [Configure DNS](#dns) and [TLS](#tls) if they are not already
set. HTTPS on this mode needs TLS enabled.

See [Panel](http://127.0.0.1:8081/settings/general/panel).

## VPN

[Project access](http://127.0.0.1:8081/settings/general/project-access) can attach Traefik to a
Tailscale tailnet. Projects become reachable on that network, not on the public
NIC. An optional private domain overrides the project base for those names.

The self-contained option runs Tailscale in a container and lets Traefik share
its network namespace. If Tailscale or another VPN already runs on the host,
choose the existing-interface option and enter that private interface address.
Portta still refuses `0.0.0.0` in both cases.

Turning Tailscale on does not publish anything on the internet. Public access
stays a separate switch.

## Local, VPN, and public exposure

| Who should reach projects | What to set |
|---|---|
| Only this machine | Project addresses on localhost. Gateway on `127.0.0.1`. Public access off. |
| A private network / tailnet | [Project access](http://127.0.0.1:8081/settings/general/project-access) set to VPN. Optional private domain. |
| The internet | [Project access](http://127.0.0.1:8081/settings/general/project-access) set to internet, a public domain, and usually [TLS](http://127.0.0.1:8081/settings/general/tls). |

The panel row in that table is independent. A public panel on its own port does
not open 80/443 for applications. A public gateway does not move the panel.

## DNS

Each scenario needs a different record, or none:

| Scenario | DNS |
|---|---|
| localhost | None |
| Automatic (`sslip.io` / `nip.io`) | None |
| Your own project domain | `*.<domain>` → this host |
| Public access on a different domain | `*.<public-domain>` → this host |
| Custom panel hostname | that hostname → this host |
| Let’s Encrypt DNS-01 | the provider must be able to create a TXT record |

[DNS settings](http://127.0.0.1:8081/settings/general/dns) are optional
Cloudflare automation for the wildcard and the DNS-01 challenge. They do not
choose the project domain.

See [Configure DNS and TLS](../guides/dns-and-tls.md) and [Configure Cloudflare DNS](../guides/cloudflare.md).
