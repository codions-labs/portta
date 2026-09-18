# Guidelines for autonomous agents

Several agents may be working on this machine right now, each in its own
worktree, each with its own containers and its own database. Everything below
follows from one fact:

> **Other environments are running, and you cannot see who they belong to.**

A short version to copy into a project's `AGENTS.md` or `CLAUDE.md` is at the
end.

## Never do these

**Never stop or remove a container you did not create.** A container holding
port 5432 is somebody's working environment. Stopping it to free the port
destroys work in progress.

**Never run `docker system prune`, `docker volume prune`, or
`docker network prune`.** They delete other people's data. There is no
situation in a shared development host where they are the right tool.

**Never remove a volume you did not create.** A volume is a database. Removing
`demo-shop_mysqldata` because it looks stale deletes hours of seeded data.

**Never change an internal port to resolve a conflict.** If 3000 is "taken",
the fix is that something is publishing it that should not be. Renumbering to
3001 makes development diverge from production and does not fix the cause.

**Never publish a database or cache on the host.** Not `5432:5432`, not
`0.0.0.0`, not even temporarily. Use the access bridge.

**Never reuse another environment's volume, network or namespace.** Two
environments sharing a database corrupt each other silently.

**Never take down the gateway to fix your own project.** It serves every
environment on the host. Your route failing is almost never the gateway's
fault; `portta doctor` will say what it is.

**Never treat "Remove from this host" as deleting a repository.** The panel
can rebuild a project and can remove it from this machine — containers,
optionally volumes, optionally the working directory — after the Compose
project name is typed back. That path never reaches GitHub. An `rm -rf`
the panel prints is for that project's working directory on this host, and
only that. Do not run it against another checkout.

## Always do these

**Use a unique namespace.**

```bash
portta envs namespace         # derives one from the repo and branch
export COMPOSE_PROJECT_NAME=demo-shop-issue59
```

Put it in the worktree's `.env` so it survives your session.

**Check ownership before touching anything.**

```bash
docker inspect <container> --format \
  '{{ index .Config.Labels "com.docker.compose.project" }}'
```

If the answer is not your namespace, it is not yours.

**Run `doctor` before improvising infrastructure.**

```bash
portta doctor
```

It reports port conflicts, hostname collisions, Traefik service-name
collisions, label mistakes and exposure problems, and suggests a fix for each.
It changes nothing.

**List your URLs after starting an environment.**

```bash
portta urls --project "$COMPOSE_PROJECT_NAME"
```

Report those, not `localhost:3000`, which is meaningless on a shared host.

**Reach databases without publishing them.** For a quick query, run a client
inside the project's own network, with no port and nothing to clean up:

```bash
docker compose exec postgres psql -U app -d app -c 'select 1'
portta db psql --project <name> --service postgres
```

For a GUI on the host, open a bridge and close it when done:

```bash
portta access open  --project <name> --service postgres   # -> 127.0.0.1:55431
portta access close --project <name>
```

Both bind loopback only, and neither changes the project. Details:
[tcp-access.md](product/guides/tcp-access.md).

**Leave the environment as you found it.** Stop what you started, from its own
directory:

```bash
portta down                    # or: portta runtime down <path>
```

Add `-v` only if the data is yours and you are sure.

## Reaching databases: the order to try

1. **`docker compose exec`**, already inside the project, nothing to set up.
2. **`portta db psql` / `redis cli`**, a client inside the project's
   network from anywhere on the host. Nothing published, nothing left behind.
3. **`portta access open`**, only when a human needs a GUI. Close it.
4. **`portta remote access open`**, for a VPS, over the VPN. Never open a
   public port to make a remote database easier to reach.

Never `ports: ["5432:5432"]`, not even temporarily, and never a database on
`0.0.0.0`. Never stop another project's database to free 5432: nothing is
holding it, because nothing publishes it.

Never reuse another workspace's volume. Two environments writing to one
database corrupt each other silently.

## When a port seems to be in use

The reflex is to free it. Don't. Find out what is actually happening:

```bash
portta envs analyze .     # does this project publish ports it need not?
docker ps --format '{{.Names}} {{.Ports}}' | grep <port>
```

Usually the project publishes a port it does not need once it is on the
gateway. Removing that `ports:` entry is the fix, and it fixes it for everyone.

## When a route does not work

```bash
portta urls               # is the hostname listed?
portta doctor             # collisions, labels, exposure
docker logs portta-traefik-1 --tail 50
```

The usual causes are in [troubleshooting.md](product/guides/troubleshooting.md): a wrong
backend port, the service missing from the shared network, a Traefik service
name colliding with another project's, or labels written in map form so
`${COMPOSE_PROJECT_NAME}` was never interpolated.

## Reading the host without touching it

The panel's API is a read-only view of everything above, in JSON, and it is
often faster than several `docker inspect` calls:

```bash
curl -s http://127.0.0.1:8081/api/status          # gateway health, counts, problems
curl -s http://127.0.0.1:8081/api/projects        # integrated projects and their services
curl -s http://127.0.0.1:8081/api/docker/host     # networks, published ports, conflicts
curl -s http://127.0.0.1:8081/api/access          # TCP services and open bridges
```

Read `http://127.0.0.1:8081/api/openapi.json` before driving the panel: it is
the complete OpenAPI 3.1 contract, including path and query parameters,
request and response schemas, error statuses, read-only refusals and the SSE
event shape. On a loopback panel, `/docs/api` provides the same contract as an
offline interactive browser.

It only exists when somebody ran `portta web up`; the CLI's `--json` flags
cover the same ground and always work.

If you are given the panel to drive, run it read-only, which refuses every
mutating endpoint:

```bash
portta web up --read-only
```

The rules above do not change because there is an API: the panel refuses to
remove a volume, a network or a gateway component, but it will happily stop a
container you did not create if you ask it to. That is still your
responsibility, not the tool's.

## Remote hosts

Databases and caches on a VPS are reached over the VPN, never over the
internet:

```bash
portta remote access open user@vps --project <name> --service postgres
```

Never enable public access to make something easier to reach. If a human wants
that, they will run `portta public enable` themselves.

---

## Short version

Copy this into `AGENTS.md` or `CLAUDE.md`:

```markdown
## Shared development host

Other environments are running on this machine. They belong to other people or
other agents, and you cannot tell which by looking.

Never:
- stop or remove a container, volume or network you did not create
- run `docker system prune` or any `docker * prune`
- change an internal port to resolve a conflict
- publish a database or cache on the host (no `5432:5432`, ever)
- reuse another environment's volume or namespace
- stop Portta to fix your own project

Always:
- set a unique `COMPOSE_PROJECT_NAME` (`portta envs namespace`)
- check ownership before touching a container:
  `docker inspect <c> --format '{{ index .Config.Labels "com.docker.compose.project" }}'`
- run `portta doctor` before improvising infrastructure
- report URLs from `portta urls`, not `localhost:3000`
- reach databases in this order: `docker compose exec`, then
  `portta db psql` / `redis cli`, then `portta access open` for a GUI,
  then `portta remote access open` over the VPN for a VPS. Never by
  publishing a port, and never on `0.0.0.0`
- stop only what you started, from its own directory

If a port seems taken, that is the signal that something publishes a port it
does not need. Fix that; do not free the port by force.
```

## Naming an environment after the issue it belongs to

The panel links a running environment to the issue it is running for, so one of
these coordinates is enough:

```bash
# a branch the panel can read
git switch -c issue-182-tcp-proxy

# a namespace portta already produces
portta envs namespace --suffix issue182

# or say it outright, in the overlay, with the whole reference
labels:
  portta.issue: "github:owner/repo#182"
```

A label carries the whole reference because an environment is not inside a
Project and has nothing to resolve a bare number against; a branch and a
namespace carry only a number, read against the Project's own repository.

The link is a row. It never starts, stops or removes anything, and a manual
link in the panel always wins over an inferred one.
