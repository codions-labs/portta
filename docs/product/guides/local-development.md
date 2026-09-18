# Develop applications locally

## Requirements

**macOS**: [OrbStack](https://orbstack.dev) or Docker Desktop, Git, a shell.
**Linux**: Docker Engine 24+, the Compose v2 plugin, Git, a shell.

OrbStack is the recommended runtime on macOS: it starts faster and uses much
less memory than Docker Desktop. The gateway does **not** depend on any
OrbStack-specific API. Anything OrbStack-only is an optimisation the gateway
detects and offers, never something it requires.

Note the versions: Docker Compose **v2** (the `docker compose` plugin). The
standalone `docker-compose` v1 binary is not supported.


## Setup

Install Portta with `portta setup` ([Install Portta](../getting-started/install.md)),
then check the gateway:

```bash
portta status
portta doctor
```

The globally installed `portta` finds the installation from any project
directory; an installation outside `~/portta` needs `PORTTA_HOME` exported.


## How `.localhost` resolves

`localhost` is reserved by [RFC 6761](https://www.rfc-editor.org/rfc/rfc6761),
which asks resolvers to map it, **and every name below it**, to loopback
without consulting DNS.

So `demo-shop-web.localhost` resolves to `127.0.0.1` with:

- no `/etc/hosts` editing,
- no `dnsmasq`,
- no local DNS daemon,
- nothing to do when a new project or worktree appears.

Portta configures none of this. It relies on whichever layer below
implements the RFC, and that layer differs by platform.

**Browsers and `curl`** resolve `*.localhost` to loopback themselves, before
asking the operating system. Safari, Chrome, Firefox, Edge and current `curl`
therefore work on any platform, which is also why a browser can succeed where
another tool on the same machine fails.

**macOS** implements it in the system resolver. Every program that uses it,
including `psql`, Node and Python, gets `127.0.0.1` and `::1` for a name
at any depth. Nothing to check.

**Linux** depends on the distribution. The C library alone does not do it:

| Layer | `*.localhost` | Typical on |
|---|---|---|
| `systemd-resolved` (`resolve` in `/etc/nsswitch.conf`) | resolves | Ubuntu, Fedora, most desktops |
| `nss-myhostname` (`myhostname` in `/etc/nsswitch.conf`) | resolves | installed with systemd; not in every `nsswitch.conf` |
| plain glibc, `hosts: files dns` | **does not resolve** | Debian and Ubuntu minimal or container images |
| musl (Alpine) | resolves | Alpine 3.20 verified |

Check what your machine does with the resolver applications use:

```bash
grep '^hosts' /etc/nsswitch.conf
getent ahosts demo-shop-web.localhost
```

No answer from `getent` while the browser works means neither
`systemd-resolved` nor `nss-myhostname` is in the lookup path. Install
`libnss-myhostname` (Debian, Ubuntu) and make sure `myhostname` appears on the
`hosts:` line, or use a
[custom local domain](local-domains.md) instead.

**IPv6.** The resolver can answer `::1` as well as `127.0.0.1`, and Traefik
listens on `127.0.0.1` only. Browsers and `curl` try `::1`, get refused, and
connect over IPv4 at once. A client that tries only the first address reports
*connection refused* for a name that resolved correctly; point it at
`127.0.0.1` explicitly, or use a custom domain that answers IPv4 only.

**Tools with their own resolver.** Some older Go binaries and JVM HTTP clients
resolve names without the system resolver and without the RFC. `dig`,
`nslookup` and `host` query DNS servers directly and always fail for
`*.localhost`, by design.

**Inside a container**, `127.0.0.1` is the container itself, not Traefik, so
`*.localhost` would be the wrong address even where it resolves. Reach another
service by its name over the shared network.

If `*.localhost` is not an option, set a
[custom local domain](local-domains.md): a `.test` name served by a small DNS
container, a public record for `127.0.0.1`, or dnsmasq. Setting
`PORTTA_DOMAIN` alone changes nothing; the domain mode has to be `custom`.

`portta doctor` resolves `portta-probe.localhost` and warns when there is no
answer, or when the answer is not loopback.


## Reach a project hostname from a container

A service calling another service should use its internal address, never the
routed hostname:

```text
http://api:8000                      same project, its own network
http://demo-shop-api-1:8000          another project, both on the shared network
```

Some applications need the **same URL** inside and outside the container: an
OAuth or OpenID Connect issuer checked against the token, server-side
rendering that fetches its own public API, a webhook URL stored in a database.
`*.localhost` is unreliable for this: inside a container `curl` and
musl-based images resolve it to the container's own loopback before any other
lookup, so an alias works for some clients and silently not for others. Use a [custom local domain](local-domains.md) and point that one name at
Traefik:

```yaml
services:
  web:
    networks: [default, portta]
    external_links:
      - portta-traefik-1:demo-shop-api.portta.test
```

On the shared network, `demo-shop-api.portta.test` then resolves to Traefik,
which routes it exactly as it does for the browser. There is no wildcard: list
each hostname the container calls. The link follows Traefik by container name,
so it survives the gateway being recreated, and does not resolve while the
gateway is down.

Without the shared network, `extra_hosts` can send the name to the host
instead:

```yaml
    extra_hosts:
      - "demo-shop-api.portta.test:host-gateway"
```

That reaches Traefik on **OrbStack and Docker Desktop**, which forward
`host-gateway` to ports published on the host's loopback. On **Linux Docker
Engine** it does not: `host-gateway` is the bridge address and Traefik listens
on `127.0.0.1`. Use `external_links` there.

To call the gateway without a resolvable name at all, send the hostname as a
header: `curl -H 'Host: demo-shop-api.localhost' http://traefik/` from any
container on the shared network.


## Open a project from another device

`*.localhost` and a loopback custom domain resolve to the device that asks, so
a phone or a second computer cannot use them. Traefik has to listen on an
address the other device can reach, and the names have to resolve to it.

| Who | Use |
|---|---|
| Your own devices, anywhere | Tailscale on this machine and on the device, and bind to the tailnet address, below. Only your tailnet reaches it |
| One person, one service, for a while | [A share](sharing.md), with an expiry and optionally a password |
| Devices on the same local network | Bind to the LAN address, below. Read the trade-offs first |

The steps are the same for both addresses; `192.168.1.10` stands for this
machine's LAN address or its tailnet address (`100.x.y.z`):

```bash
portta config set gateway.domain 192-168-1-10.sslip.io --no-apply
portta config set domain.mode custom --no-apply
portta config set gateway.bindAddress 192.168.1.10
```

`192-168-1-10.sslip.io` resolves to `192.168.1.10` from any device with
internet DNS, so nothing is configured on the phone. The `auto` domain mode is
not for this: it detects the public internet address instead.

The trade-offs of a LAN bind:

- It publishes **every routed service** of every project to everyone on that
  network, with no authentication. Fine on a home network, not in a café or an
  office.
- The address changes when DHCP hands out a new one, and every hostname with
  it. A DHCP reservation on the router avoids that.
- A router with DNS rebinding protection may discard the private answer. Then
  the names fail on that network only.

A tailnet address has none of those problems, which is why it is the first
choice.

The address must exist when the gateway starts. If the network or Tailscale
comes up after Docker, run `portta up local` again.

Undo it with `portta config set gateway.bindAddress 127.0.0.1` and
`portta config set domain.mode local`.


## Which setup for which situation

| Situation | Resolution |
|---|---|
| Browser works, `psql`, a Go or Java tool fails (Linux) | [How `.localhost` resolves](#how-localhost-resolves): add `nss-myhostname`, or use a custom domain |
| The name resolves, the connection is refused | The client tried `::1` only; use `127.0.0.1` for it ([IPv6](#how-localhost-resolves)) |
| A shorter or product-like name, such as `*.portta.test` | [Use a custom local domain](local-domains.md) |
| The whole team should use the same names | [A public record for `127.0.0.1`](local-domains.md#option-1-a-public-record-pointing-at-loopback) |
| Names must work offline | [A DNS container](local-domains.md#option-2-a-dns-server-in-a-container) or [dnsmasq](local-domains.md#option-3-dnsmasq-on-the-host) |
| A container must call the public URL | [Reach a project hostname from a container](#reach-a-project-hostname-from-a-container) |
| A phone or another computer must open it | [Open a project from another device](#open-a-project-from-another-device) |
| A custom domain works in the terminal but not in the browser, or stops on a VPN | [When it resolves in one place and not another](local-domains.md#when-it-resolves-in-one-place-and-not-another) |
| HTTPS, Secure cookies, service workers | [HTTPS locally](#https-locally-optional) |
| Port 80 is already taken | [If port 80 is taken](#if-port-80-is-taken) |
| A remote machine instead of this one | [Choose remote access](remote-development.md) |


## Everyday use

```bash
portta status
portta urls
portta logs
portta doctor
```

Start application services with Compose from their own project directory.


## Running several environments

The Compose namespace is derived from the checkout and its branch, so a
worktree is a second environment with nothing to configure:

```bash
portta adopt ~/projects/demo-shop
portta runtime up ~/projects/demo-shop
# -> demo-shop-web.localhost

git worktree add --relative-paths ../demo-shop-issue59 issue59
portta adopt ~/projects/demo-shop-issue59
portta runtime up ~/projects/demo-shop-issue59
# -> demo-shop-issue59-web.localhost
```

Both run at once, each with its own containers, network, volumes and database.
Inside either directory, `portta up`, `portta status`, `portta logs` and
`portta down` operate that one environment.


## HTTPS locally (optional)

Plain HTTP works with no setup, and for most local work that is the right
choice. HTTPS is worth enabling when you need Secure cookies, service workers,
or anything else gated behind a secure context.

It is opt-in and never required. See [Configure DNS and TLS](dns-and-tls.md).
From another device, over the LAN or a tailnet, the same CA has to be trusted
on that device; [Which profile, which TLS](dns-and-tls.md#which-profile-which-tls)
says what that costs and when plain HTTP is the better choice.


## If port 80 is taken

Run `portta doctor` and identify the owner. Do not stop another environment to free its port. Coordinate gateway listeners with the host operator.
