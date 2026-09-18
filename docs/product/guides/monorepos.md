# Use monorepos and worktrees

A monorepo needs nothing special. It is one Compose project with more services
in it, and the gateway already keys everything off the Compose project name.

```text
demo-shop/
  apps/
    web/          Dockerfile
    admin/        Dockerfile
  services/
    api/          Dockerfile
    worker/       Dockerfile
    importer/     Dockerfile
  compose.yaml
```

One namespace, one private network, one set of volumes, and a hostname per
service that serves HTTP:

```text
demo-shop-web.localhost
demo-shop-admin.localhost
demo-shop-api.localhost
```

`worker` and `importer` serve no HTTP, so they get no networks and no labels
and keep running exactly as they did.

See [`templates/overlays/06-monorepo.yaml`](../../../templates/overlays/06-monorepo.yaml).

## What stays in the monorepo

Everything. Dockerfiles, build contexts, volumes, the Compose file, the release
process. The gateway centralises **routing**, not builds and not deployment. It
never needs to know your directory layout, and there is nothing to configure in
the gateway when you add an app.

Adding one is a service in `compose.yaml` and `portta runtime up` again, which
refreshes the plan; name the port with `portta adopt --service new-app:3000`
when it cannot be inferred.

## One namespace or several?

**One** is the default and almost always right. The services share a private
network, so they reach each other by service name, and one `docker compose up`
brings the whole thing up.

**Several**, a separate Compose project per app, makes sense only when apps
are genuinely independent: separate databases, separate lifecycles, and you
routinely run one without the others. The cost is real: they do not share a
private network, so cross-app calls have to go through the gateway by hostname,
and you manage several namespaces by hand.

If you do split:

```bash
portta adopt apps/web --project demo-shop-web
portta adopt services/api --project demo-shop-api
portta runtime up apps/web
portta runtime up services/api
```

Note the hostnames become `demo-shop-web-web.localhost`, with the
namespace and the service name both in there. Usually a reason to keep one
namespace.

## Worktrees of a monorepo

Identical to any other project: the namespace follows the branch.

```bash
git worktree add --relative-paths ../demo-shop-issue59 issue59
portta adopt ../demo-shop-issue59
portta runtime up ../demo-shop-issue59
```

Every app in the worktree gets its own hostname, and the whole worktree gets
its own database. Both copies run at once.

## Shared build layers

Monorepos often share a base image between apps. That is a build concern and
the gateway is not involved, but it does interact with namespaces in one way:
if you tag a shared base image with a fixed name, two worktrees building
concurrently will race to overwrite it.

Tag per namespace, or build the base once and reference it read-only:

```yaml
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    image: ${COMPOSE_PROJECT_NAME}-web
```

## Analyzing one

```bash
portta envs analyze /path/to/monorepo
```

It reads the resolved Compose model, so it sees every service regardless of
where its Dockerfile lives, classifies each, and proposes only the ones that
look like they serve HTTP.

## A monorepo is one repository in one Project

The Project model does not treat a monorepo as a special case: it is a
Project that owns exactly one repository. What differs is what runs against
it — several worktrees, each its own `COMPOSE_PROJECT_NAME`, each adopted by
the same Project.

```text
Project  "Plataforma"
├── repositories   acme/plataforma
└── environments   plataforma            (label)
                   plataforma-issue182   (repo-match)
                   plataforma-issue190    (repo-match)
```

The worktrees stay independent environments: their
overrides do not inherit, their hostnames do not collide, and stopping one
touches none of the others. The Project is what says they are the same
product.

See [Work and issues](../concepts/work-and-issues.md) for how an environment is tied to the issue it is running for, which is what makes one worktree per issue readable in the panel.
