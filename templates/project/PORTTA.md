# Running this project on Portta

> Copy this file into the project and adjust the names. It covers only what
> someone working on *this* project needs. The rules themselves live in the
> Portta repository, which stays the single source of truth.

## Prerequisites

Portta must be running on this machine:

```bash
portta status      # if this fails: portta bootstrap && portta up local
```

## Starting

```bash
docker compose -f compose.yaml -f compose.portta.yaml up -d
```

Set `COMPOSE_FILE=compose.yaml:compose.portta.yaml` in `.env` to drop the
`-f` flags.

## Namespace

`COMPOSE_PROJECT_NAME` is what keeps this environment separate from every other
one on the host: containers, network, volumes and hostnames all derive from it.

```env
# .env
COMPOSE_PROJECT_NAME=<project>
```

## URLs

```bash
portta urls --project <project>
```

| Service | URL |
|---|---|
| web | `http://<project>-web.localhost` |
| api | `http://<project>-api.localhost` |

No port numbers, and no host port is published for either.

## Database and cache

Not published on the host. Two ways in:

**From inside the project**, with nothing to open and nothing to close:

```bash
docker compose exec postgres psql -U <user> -d <db>
docker compose exec redis redis-cli
```

**From a GUI on the host**, through a temporary loopback bridge on a free port:

```bash
portta access open --project <project> --service postgres
# -> 127.0.0.1:55431

portta access list
portta access close --project <project>
```

Point TablePlus, DBeaver or DataGrip at `127.0.0.1` and the port it printed.
Credentials are this project's, from its own `.env`.

## Working on two branches at once

```bash
git worktree add --relative-paths ../<project>-issue59 issue59
cd ../<project>-issue59
echo "COMPOSE_PROJECT_NAME=<project>-issue59" >> .env
docker compose -f compose.yaml -f compose.portta.yaml up -d
# -> http://<project>-issue59-web.localhost
```

Both run at once, each with its own database. The first environment is not
affected.

## Troubleshooting

```bash
portta doctor
portta urls --project <project>
docker compose logs -f
```

**404**: the service did not opt in, or Traefik has not discovered it yet.
**502**: the route matched but the backend did not answer, usually the wrong
port in the overlay, or the service is not on the `portta` network.

More: Portta's `docs/product/guides/troubleshooting.md`.

## Without the gateway

The overlay only adds networks and labels, so the project still runs on its own:

```bash
docker compose up -d
```

You lose hostname routing, so you will need published ports. Put those in your
personal `compose.override.yaml`, not in the shared files.
