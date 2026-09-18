# Troubleshooting

Start here:

```bash
portta doctor
```

It checks the runtime, networks, component health, exposure, DNS, TLS, route
collisions and label mistakes, and prints a suggested fix for anything that
fails. It never changes anything.

---

## A hostname does not resolve

Ask the resolver your applications use, not `ping` or `dig`:

```bash
dscacheutil -q host -a name demo-shop-web.localhost    # macOS
getent ahosts demo-shop-web.localhost                  # Linux
```

**The browser works, another tool does not.** Browsers and `curl` resolve
`*.localhost` themselves. On Linux the system resolver only does it through
`systemd-resolved` or `nss-myhostname`; plain glibc does not. See
[How `.localhost` resolves](local-development.md#how-localhost-resolves) for
the check and the fix.

**It resolves, but the connection is refused.** The client tried `::1` and did
not fall back to `127.0.0.1`, where Traefik listens. Use `127.0.0.1`
explicitly for that client.

**A custom domain does not resolve.** On macOS, `dig` ignores
`/etc/resolver` and reports a failure for a domain that works; use
`dscacheutil`. Otherwise check the piece that answers for it, in
[Use a custom local domain](local-domains.md#verify-resolution).

**Inside a container**, `127.0.0.1` is the container itself. Reach the service
by its name over the shared network, or see
[Reach a project hostname from a container](local-development.md#reach-a-project-hostname-from-a-container)
when it must use the public URL.

**Another device cannot open it.** Loopback names only resolve on this machine;
see [Open a project from another device](local-development.md#open-a-project-from-another-device).

Every other naming situation, with its fix, is indexed in
[Which setup for which situation](local-development.md#which-setup-for-which-situation).

## 404 from the gateway

Traefik answered, but no router matched. In order of likelihood:

```bash
portta urls        # is the hostname listed at all?
```

**Not listed.** The container did not opt in. Check it has
`traefik.enable=true`, and that it is actually running:

```bash
docker inspect <container> --format '{{json .Config.Labels}}' | jq
```

**Listed but 404.** Usually a stale route. Traefik discovers asynchronously;
give it a couple of seconds after `up`. If it persists:

```bash
PORTTA_LOG_LEVEL=DEBUG portta up local
portta logs traefik
```

**A literal `${...}` in a label.** The labels were written in map form.
Compose interpolates `${VAR}` inside a *list* entry but not inside a mapping
key. Rewrite as a list:

```yaml
labels:
  - "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

`doctor` reports this specifically.

## 502 / 504 from the gateway

The router matched but Traefik could not reach the backend.

**Wrong port.** Traefik guesses from the image's `EXPOSE` when no port is
declared. If your app listens on 3000 but the image exposes 80, say so:

```yaml
- "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

**Not on the shared network.** The service must join `portta` as well as
its own network:

```bash
docker inspect <container> --format '{{json .NetworkSettings.Networks}}' | jq 'keys'
```

**Wrong network chosen.** A multi-homed container has two addresses; if Traefik
picked the private one it cannot reach it. Add:

```yaml
- "traefik.docker.network=portta"
```

**The app is bound to `127.0.0.1` inside its container**, so nothing outside
the container can reach it. It must listen on `0.0.0.0`.

## One project receives another project's traffic

Traefik service names are one flat namespace across the host. Two projects
declaring `traefik.http.services.web...` are merged into a single load
balancer. Prefix with the namespace:

```yaml
- "traefik.http.services.${COMPOSE_PROJECT_NAME}-web.loadbalancer.server.port=3000"
```

`doctor` reports both this and hostname collisions between projects whose names
differ only in punctuation (`foo_bar` and `foo-bar` normalise identically).

## Port 80 or 443 is already in use

```bash
lsof -nP -iTCP:80 -sTCP:LISTEN     # macOS
ss -ltnp sport = :80               # Linux
```

Stop the other process, or set `PORTTA_HTTP_PORT=8080` and use
`http://demo-shop-web.localhost:8080`.

## Traefik keeps restarting

Almost always a bad static configuration key. Traefik names the exact node it
could not decode:

```bash
docker logs portta-traefik-1 2>&1 | tail -5
# failed to decode configuration from environment variables: field not found, node: ...
```

Nested keys are the usual cause: `aliasHeadersStrategy` lives under `http`, so
the variable is `TRAEFIK_ENTRYPOINTS_WEB_HTTP_ALIASHEADERSSTRATEGY`, not
`TRAEFIK_ENTRYPOINTS_WEB_ALIASHEADERSSTRATEGY`.

## The socket proxy is unhealthy

Its entrypoint renders a config into `/tmp`, and the container runs
`read_only: true`. It needs the tmpfs mounts declared in
`docker/compose/compose.yaml`:

```bash
docker logs portta-socket-proxy-1
# can't create /tmp/haproxy.cfg: Read-only file system
```

## Postgres 18 will not start

PostgreSQL 18+ images store data in a major-version subdirectory and refuse to
start when `.../data` is mounted directly. Mount the parent:

```yaml
volumes:
  - pgdata:/var/lib/postgresql      # not /var/lib/postgresql/data
```

## `portta down` did not remove the shared network

That is intentional. Other projects are attached to it, and the gateway never
removes a network other people are using. Remove it deliberately once nothing
is attached:

```bash
docker network inspect portta --format '{{ len .Containers }}'
docker network rm portta
```

## A command seems to hang

It is almost always a pull or a build, not a hang. A phase announces itself,
a build streams its own progress, and anything quiet reports how long it has
been going:

```text
wait     still running: docker compose up (2m10s)
```

`--verbose` streams every child process. `Ctrl-C` during a build is safe:
BuildKit keeps the layers it has finished, so the next run resumes rather than
starting over. Checkout only: the first `just dev`, and any run after a
dependency change, builds the panel image, which takes minutes.

## Everything looks right and it still does not work

```bash
portta doctor --json | jq '.data.checks[] | select(.status != "pass")'
portta inspect
docker logs portta-traefik-1 --tail 50
```

Include those three in a bug report.
