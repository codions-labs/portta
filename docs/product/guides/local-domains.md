# Use a custom local domain

`*.localhost` needs nothing and is the right default
([Develop applications locally](local-development.md#how-localhost-resolves)).
A different base, such as `*.portta.test` or `*.dev.example.com`, works just as
well for routing: Traefik matches whatever base is configured. The only new
question is **what makes that name resolve to `127.0.0.1`**, and Portta does
not install or change a resolver on your machine.

## Can it all run in Docker?

Not entirely, and no configuration can change that.

A browser, `curl` or `psql` asks the operating system's resolver for an
address before a single packet reaches Docker. A container can *answer* DNS
queries, but only the host decides to *ask* it. So:

- the **DNS server** can run in a container;
- **telling the host to use it** for one domain is host configuration, made
  once;
- a **public DNS record** is the one option with nothing on the host at all.

Because every option below is a wildcard (except `/etc/hosts`), the host-side
step happens once, never per project, service or worktree.

| Option | On the host | Wildcard | Offline |
|---|---|---|---|
| [Public record for `127.0.0.1`](#option-1-a-public-record-pointing-at-loopback) | nothing | yes | no |
| [DNS server in a container](#option-2-a-dns-server-in-a-container) | one resolver file | yes | yes |
| [dnsmasq on the host](#option-3-dnsmasq-on-the-host) | a package and one file | yes | yes |
| [`/etc/hosts`](#option-4-the-hosts-file) | one line per hostname | no | yes |

## Choose the name

| Base | Verdict |
|---|---|
| `portta.test` | **Recommended.** `.test` is reserved ([RFC 6761](https://www.rfc-editor.org/rfc/rfc6761)) and never exists on the internet |
| `portta.internal` | Good. ICANN reserved `.internal` for private use |
| `dev.example.com` | Good, for a domain you own. The only kind a public record can serve |
| `portta.local` | **Avoid.** `.local` belongs to multicast DNS ([RFC 6762](https://www.rfc-editor.org/rfc/rfc6762)): macOS hands it to Bonjour, and Linux hosts with `mdns4_minimal [NOTFOUND=return]` stop before ordinary DNS is asked |
| `portta.dev`, `portta.app` | **Avoid, unless you own it.** Real public TLDs on the HSTS preload list: browsers refuse plain HTTP for every name under them, and a local override silently shadows a domain somebody else can register |

Use a name of your own below the reserved TLD (`portta.test`), not the TLD
itself. Claiming all of `.test` collides with other tools that already do,
such as Laravel Valet or a hand-made dnsmasq setup, and makes every `.test`
name on the machine resolve to Portta.

Hostnames stay flat: `demo-shop-web.portta.test`.

## Option 1: a public record pointing at loopback

With a domain you own, one record makes every project name resolve on any
machine, with no host configuration:

```text
A    *.dev.example.com    127.0.0.1    ; DNS-only, never proxied
```

Create it by hand at your DNS provider. `portta dns setup` manages the
`PUBLIC_DOMAIN` / `PRIVATE_DOMAIN` records of the remote profiles, not this one.

The trade-offs:

- **It needs a working upstream resolver.** Offline, the names stop resolving.
- **DNS rebinding protection can drop it.** Some routers, Pi-hole, dnsmasq with
  `stop-dns-rebind`, Unbound with `private-address`, and many corporate
  resolvers discard public answers that point at loopback or private addresses.
  The names then fail on that network only.
- **The record is public.** It reveals that the name exists, nothing more:
  `127.0.0.1` is every visitor's own machine.

**Without a domain**, [sslip.io](https://sslip.io) and [nip.io](https://nip.io)
already answer for loopback:

```text
demo-shop-web.127-0-0-1.sslip.io  →  127.0.0.1
```

Use `127-0-0-1.sslip.io` as a custom domain (the `auto` mode derives its name
from the host's public address instead). It depends on a third-party service
being up.

## Option 2: a DNS server in a container

A small CoreDNS container answers for the domain, and the host routes only
that domain to it.

### Start the server

Keep it outside the Portta directory: it is host configuration, not part of
the gateway, and `portta down` should not take name resolution with it.

`~/portta-dns/compose.yaml`:

```yaml
name: portta-dns

services:
  coredns:
    image: coredns/coredns:1.11.3
    command: ["-conf", "/etc/coredns/Corefile"]
    volumes:
      - ./Corefile:/etc/coredns/Corefile:ro
    ports:
      - "127.0.0.1:5354:5354/udp"
      - "127.0.0.1:5354:5354/tcp"
    restart: unless-stopped
```

`~/portta-dns/Corefile`:

```text
portta.test:5354 {
    template IN A {
        answer "{{ .Name }} 60 IN A 127.0.0.1"
    }
    template IN AAAA {
        rcode NOERROR
    }
}
```

```bash
cd ~/portta-dns && docker compose up -d
dig +short @127.0.0.1 -p 5354 demo-shop-web.portta.test    # 127.0.0.1
```

Every name under `portta.test`, at any depth, answers `127.0.0.1`. `AAAA` is
answered empty on purpose: Traefik listens on `127.0.0.1` only, so no client
should be sent to `::1`. Any other name is refused, so the server never
answers for the rest of the internet.

Port `5354` avoids `53`, which a local resolver often holds, and `5353`, which
is multicast DNS. The port is published on loopback only; a DNS server should
never be reachable from the network.

The names resolve only while the container runs. If your Docker runtime does
not start at login, neither do they.

### Route the domain on macOS

A file in `/etc/resolver`, named after the domain:

```bash
sudo mkdir -p /etc/resolver
printf 'nameserver 127.0.0.1\nport 5354\n' | sudo tee /etc/resolver/portta.test
scutil --dns | grep -A3 'domain   : portta.test'
```

macOS picks the resolver with the most matching domain labels, so
`/etc/resolver/portta.test` wins over an existing `/etc/resolver/test`.

### Route the domain on Linux with systemd-resolved

Ubuntu, Fedora and most desktop distributions resolve through
`systemd-resolved`. Check that yours does: `resolvectl status` answers, and
`/etc/resolv.conf` names `127.0.0.53`. Then add a drop-in:

```bash
sudo mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNS=127.0.0.1:5354\nDomains=~portta.test\n' \
  | sudo tee /etc/systemd/resolved.conf.d/portta.conf
sudo systemctl restart systemd-resolved
resolvectl query demo-shop-web.portta.test
```

`~portta.test` is a routing domain: names under it go to the container, and
nothing is added to the search list. Two consequences, both harmless:

- `systemd-resolved` also asks a global server about unrelated names. The
  container refuses them at once and the network's own DNS answers, so
  ordinary lookups still work.
- With the container stopped, `*.portta.test` fails immediately and
  everything else keeps resolving.

A port in `DNS=` needs systemd 246 or later.

### Linux without systemd-resolved

glibc and musl read `/etc/resolv.conf`, which has no per-domain routing: the
first nameserver listed is asked about every name. Listing the container there
would make all of the host's DNS depend on it, and on Docker running. Use
[dnsmasq on the host](#option-3-dnsmasq-on-the-host) instead.

## Option 3: dnsmasq on the host

The classic setup, with no container involved.

**macOS** (Homebrew):

```bash
brew install dnsmasq
echo 'address=/portta.test/127.0.0.1' >> "$(brew --prefix)/etc/dnsmasq.conf"
sudo brew services start dnsmasq
sudo mkdir -p /etc/resolver
echo 'nameserver 127.0.0.1' | sudo tee /etc/resolver/portta.test
```

**Linux with systemd-resolved:** run dnsmasq on a spare port
(`port=5354`, `listen-address=127.0.0.1`, `address=/portta.test/127.0.0.1`)
and route the domain to it with the same drop-in as
[Option 2](#route-the-domain-on-linux-with-systemd-resolved).

**Linux with NetworkManager and no systemd-resolved:** let NetworkManager run
dnsmasq as the local resolver.

```bash
printf '[main]\ndns=dnsmasq\n' | sudo tee /etc/NetworkManager/conf.d/00-dnsmasq.conf
echo 'address=/portta.test/127.0.0.1' | sudo tee /etc/NetworkManager/dnsmasq.d/portta.conf
sudo systemctl restart NetworkManager
```

`address=/portta.test/127.0.0.1` matches the domain and every name below it.

## Option 4: the hosts file

```text
127.0.0.1  demo-shop-web.portta.test
127.0.0.1  demo-shop-api.portta.test
```

`/etc/hosts` has no wildcards. Every service, project and worktree needs its
own line, added before its first request, which is exactly the upkeep a
wildcard avoids. Reasonable for one fixed name, not for a working set of
environments.

## Point Portta at the domain

```bash
portta config set gateway.domain portta.test --no-apply
portta config set domain.mode custom
```

The second command applies the change, which recreates Traefik: every route
on the host is briefly unavailable. Every project is re-labelled at once;
nothing in a project changes.

The panel does the same from
[Project addresses](http://127.0.0.1:8081/settings/general/project-domain),
under **Your own domain**.

```bash
portta urls
portta doctor
```

`doctor` resolves a name under the wildcard and recognises loopback:

```text
ok   wildcard DNS: *.portta.test -> 127.0.0.1 (this machine)
ok   project hostnames: *.portta.test resolves to loopback, served on 127.0.0.1
```

## HTTPS

The local certificate covers the base that was configured when it was issued.
After changing the domain, issue it again; the CA is reused, so nothing needs
to be trusted twice:

```bash
portta tls init
portta up local
```

On the `local` profile, certificates always come from the local CA, even for a
public domain; `TLS_MODE=acme` belongs to the remote profiles. Under `.dev` or
`.app` this step is not optional: browsers refuse plain HTTP there. See
[Configure DNS and TLS](dns-and-tls.md).

## Verify resolution

Check with the resolver your applications use, not a DNS tool that bypasses
it:

```bash
# macOS
dscacheutil -q host -a name demo-shop-web.portta.test

# Linux
getent ahosts demo-shop-web.portta.test
resolvectl query demo-shop-web.portta.test     # with systemd-resolved
```

On macOS, `dig`, `nslookup` and `host` read `/etc/resolv.conf` and ignore
`/etc/resolver`, so they report a failure for a domain that works everywhere
else. `dig @127.0.0.1 -p 5354 <name>` tests the server itself.

## When it resolves in one place and not another

**The terminal resolves it, the browser does not.** The browser is using
secure DNS (DNS over HTTPS) with a fixed provider, which never asks the system
resolver. In Firefox, add the domain under *Settings → Privacy & Security →
DNS over HTTPS → Manage Exceptions* (the `network.trr.excluded-domains`
preference). In Chrome and Edge, set *Use secure DNS* to your current service
provider, or turn it off. `*.localhost` is not affected: browsers resolve it
themselves.

**It stops when a VPN connects.** The VPN client took over DNS. Check that the
route for the domain is still there: `scutil --dns` on macOS lists
`portta.test`, and `resolvectl status` on Linux still shows `~portta.test`. A
more specific routing domain normally wins over a VPN's catch-all, but some
clients replace the whole configuration or block DNS to loopback. Then use a
[public record](#option-1-a-public-record-pointing-at-loopback) or the
[hosts file](#option-4-the-hosts-file) for the names you need.

**It stops on one network.** With a public record, that network's resolver
discards answers pointing at loopback (DNS rebinding protection). Use a
[DNS container](#option-2-a-dns-server-in-a-container) or dnsmasq, which never
leave the machine.

**It stops after a reboot.** The DNS container starts with Docker. If your
Docker runtime does not start at login, the names do not resolve until it
does; dnsmasq on the host has no such dependency.

**One tool fails, everything else works.** The tool has its own resolver.
On macOS, `dig`, `nslookup` and `host` ignore `/etc/resolver`; test with
`dscacheutil` instead. For any other tool, add the names it needs to
`/etc/hosts`, which nearly every resolver reads, or connect it to `127.0.0.1`
and send the hostname as the `Host` header.

## For a team

A [public record](#option-1-a-public-record-pointing-at-loopback) is the only
option configured once for everybody: every machine resolves the same names
with nothing installed. The other options are per machine, and the steps above
are the whole setup.

## Databases and TCP routing

Routed databases use the same base, so
[TCP routing](tcp-routing.md) names become
`storefront-postgres.portta.test:5432`. They are served with the local
wildcard certificate: `sslmode=require` accepts it as it is, and
`verify-full` checks it against the name, so run `portta tls init` after
changing the domain.

## Containers

None of this reaches inside a container, and it should not: `127.0.0.1`
there is the container itself, not Traefik. A container reaches another
service by its internal name. When it has to call the public URL, as an OAuth
issuer or server-side rendering does, see
[Reach a project hostname from a container](local-development.md#reach-a-project-hostname-from-a-container).

## Undo

```bash
portta config set domain.mode local
```

Then remove what the option added: the record at your DNS provider,
`/etc/resolver/portta.test`, `/etc/systemd/resolved.conf.d/portta.conf`
(followed by `sudo systemctl restart systemd-resolved`), the dnsmasq line, or
the `/etc/hosts` lines. Stop the container with
`docker compose down` from `~/portta-dns`.

## What was verified

- CoreDNS with the files above, on macOS with OrbStack: wildcard answers at any
  depth, empty `AAAA`, other names refused.
- The `systemd-resolved` drop-in on systemd 255 (Ubuntu 24.04): routed names
  resolve, unrelated names resolve through the network's DNS, and a stopped
  container fails only `*.portta.test`.
- `/etc/resolver` with a host dnsmasq on macOS, and the most-specific-domain
  rule from `resolver(5)`.
- `127-0-0-1.sslip.io` and `127-0-0-1.nip.io` resolving to loopback.

- From containers: `external_links` to Traefik on the shared network, and
  `host-gateway` on OrbStack.

The NetworkManager variant follows its documented dnsmasq plugin and was not
run by Portta's tests. Windows and WSL2 are
[untested](../reference/compatibility.md).
