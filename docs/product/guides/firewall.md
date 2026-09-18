# Configure firewall rules

The gateway **never changes a firewall rule**. It tells you what is listening
and what a rule set should look like; applying it stays your decision.

Settings → Environment → Host security reports every supported firewall it can
observe (`ufw`, firewalld, nftables and macOS pf), whether it is active, and a
default inbound policy when the command exposes one. Collection runs on the
host through `portta envs report`; it never invokes `sudo`. “Could not be
checked” therefore means exactly that, not “inactive” or “not installed”.

Portta does not apply any recommendation from the panel. The commands below
remain operator decisions because an incorrect firewall or SSH change can lock
you out of a remote machine.

```bash
portta network status
```

shows interfaces, the tailnet address, every published port split by whether
the gateway or a consumer project owns it, and the host listeners on the
gateway's ports.

## Ubuntu with UFW

### Private profile (recommended)

Nothing needs to be open. Traefik listens on the tailnet interface only, and
Tailscale itself needs no inbound rule, because it establishes outbound
connections and negotiates a path.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH          # keep this, or lock yourself out
sudo ufw enable
```

Optionally allow the Tailscale interface explicitly:

```bash
sudo ufw allow in on tailscale0
```

### Public profile

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Those two, and nothing more. Never open 5432, 3306, 6379, 27017 or 2375/2376.

## Docker and UFW

Worth knowing: **Docker's published ports bypass UFW.** Docker writes its own
`iptables` rules in the `DOCKER-USER` chain, ahead of the ones UFW manages. A
`ports:` entry bound to `0.0.0.0` is reachable even with UFW denying
everything.

This is exactly why the gateway treats the bind address as the security
boundary rather than the firewall:

- the local profile binds `127.0.0.1`;
- the private profile refuses `0.0.0.0` and, with Tailscale, publishes nothing
  at all;
- databases and caches are never published, in any profile.

To filter Docker-published ports, write rules into `DOCKER-USER` directly:

```bash
sudo iptables -I DOCKER-USER -i eth0 -p tcp --dport 5432 -j DROP
```

Prefer not publishing the port in the first place.

## Verifying from outside

The check that matters cannot be run on the host itself. From another machine,
outside your tailnet:

```bash
nc -zv vps.example.com 80
nc -zv vps.example.com 443
nc -zv vps.example.com 5432     # must fail, in every profile
```

In the private profile, all three should fail.

## Cloud provider firewalls

A security group or cloud firewall usually sits in front of the host and is
evaluated before anything on it. Both have to allow a port for it to be
reachable, and the cloud layer is a good place to keep 80/443 closed while you
are on the private profile.
