# Connect to a database or cache

Short version, by situation. The reasoning is in
[Open a TCP bridge](tcp-access.md).

Everything here is about a *project's* database or cache — the PostgreSQL,
MySQL or Redis your application runs. The panel's own database is not one of these: it is a
SQLite file the panel opens in its own process, with no port, no network and no
credential, and it is reached through
[Back up and restore the panel](backup-restore.md) rather than through a bridge
([Persistence](../concepts/persistence.md)).

## From the application

Nothing changes and nothing is needed. The application reaches
`postgres:5432` over the project's own private network, exactly as it always
did.

## From a GUI on this machine

```bash
portta access open --project demo-shop --service postgres
# -> 127.0.0.1:33077
```

| | |
|---|---|
| Host | `127.0.0.1` |
| Port | the one printed |
| User / password / database | the project's own, from its `.env` — or from the panel's Connect panel, which reads the container environment on demand |

Add `--local-port 55432` to keep a saved connection working across sessions.
Otherwise the kernel picks a new free port each time, which is what lets four
databases be open at once.

```bash
portta access list
portta access close --project demo-shop
```

## From the terminal, or from an agent

Do not open a bridge. Run the client inside the project's network:

```bash
portta db psql --project demo-shop
portta db psql --project demo-shop -- -c 'select count(*) from users'
portta db psql --project demo-shop -- -f migrations/001.sql
```

Nothing is published, and the container is removed when you exit. Credentials
come from the target container's own environment.

MySQL and Redis work the same way:

```bash
portta db mysql --project some-project
portta redis cli --project demo-shop
portta redis cli --project demo-shop -- keys 'session:*'
```

Or, with no gateway involved at all:

```bash
docker compose exec postgres psql -U app -d app
```

## From a VPS

`portta remote access open deploy@vps --project demo-shop --service postgres`
gives you a local address for a database on a remote host; see
[Reach a remote service](remote-tunnels.md).

## Every day, at a stable address

```bash
portta service publish --private \
  --project demo-shop --service postgres
```

A dedicated forwarder with a stable alias on the gateway's access network,
reachable over the tailnet at the standard port. Each published service gets
its own forwarder; project networks are never merged. See
[Configure persistent Tailscale services](tailscale-services.md).

## Several databases at once

That is the whole point, and it needs no special handling:

```bash
portta access open --project demo-shop  --service postgres  # -> :33077
portta access open --project demo-site  --service postgres  # -> :33079
portta access open --project issue-flow --service postgres  # -> :33081
portta access list
```

All three still listen on 5432 inside their containers. None publishes it.

## Redis

The same shape, with `redis` in the command:

```bash
portta redis open --project demo-shop
# -> 127.0.0.1:33078
redis-cli -h 127.0.0.1 -p 33078
```

Or with RedisInsight / TablePlus: host `127.0.0.1`, the printed port. The
panel's Access page offers the same addresses and, when `REDIS_PASSWORD` is in
the container environment, a complete string.

A project with more than one Redis (one for cache, one for queues) names the
service; `portta envs services --project demo-shop` lists what is there:

```bash
portta access open --project demo-shop --service redis-cache
portta access open --project demo-shop --service redis-queue
```

Both keep 6379 inside their containers. There is no host port, so there is no
need to split them across 6379 and 6380.

`FLUSHALL` on the wrong bridge is indistinguishable from `FLUSHALL` on the
right one. Check `portta access list` first, or prefer
`portta redis cli --project <name>`, where the project is in the command.

## Migrations and seeds

Run them where they have always run, inside the project:

```bash
docker compose run --rm api npm run migrate
docker compose exec api php artisan migrate
```

The gateway has no opinion about migrations and no access to your data. It
never runs one for you.

## Backups

```bash
portta db psql --project demo-shop -- -c '\copy users to stdout csv' > users.csv
```

For a full dump, use `pg_dump` inside the project so the file lands where you
want it:

```bash
docker compose exec -T postgres pg_dump -U app app > backup.sql
```

## What not to do

**Do not add `ports: ["5432:5432"]`** to get a database "temporarily" onto the
host. That is the port conflict this whole design removes, and it makes the
database reachable by everything else on the machine.

**Do not point two worktrees at one database.** Let Compose create a volume per
namespace. Two environments writing to one database corrupt each other, and it
is silent until it is not.

**Do not publish a database on `0.0.0.0`.** `doctor` fails on it, and
`service publish --public` refuses outright.

## Reaching it by hostname instead

If the gateway has `PORTTA_TCP=true` and the project opted in, its
PostgreSQL has a stable address that needs no bridge and no free port:

```bash
psql "postgresql://demo@demo-shop-postgres.localhost:5432/demo?sslmode=require"
```

The `sslmode` is not decoration: the hostname travels inside the TLS handshake,
and without TLS there is nothing for the gateway to route on. MySQL cannot do
this at all. Redis needs the SNI named explicitly, because `redis-cli` does not
derive it from `-h`; most client libraries do set it from the host they are
given:

```bash
redis-cli -h 127.0.0.1 -p 6379 --tls --sni demo-shop-redis.localhost
```

See [Configure TCP routing](tcp-routing.md).

The panel's Access page lists every address that applies to this host — LAN,
tailnet, domain, loopback bridge — each with its scope. **Connect** reads the
container environment on demand and fills the connection string when the
image uses conventional variables (`POSTGRES_*`, …). The password is masked
until you ask for it, and can be copied without being revealed. Opening that
panel creates no route, bridge or published port.
