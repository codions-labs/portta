---
name: portta-dockerize
description: Creates a minimal Compose file and Dockerfile for a web project that has none, so it can run behind a Portta gateway with no published ports. Use when the Portta preflight reports needs-dockerizing, or when asked to containerize an app on a Portta host so it gets a routed URL. Always asks for approval before writing files, then hands over to portta-adopt-compose.
license: MIT
compatibility: Requires the portta CLI on a Portta host and read access to the project directory. Writes files only after the person approves.
metadata:
  author: codions-labs
  version: "1"
---

# Dockerize a project for Portta

A project with no Compose file cannot be adopted. This skill writes the
smallest Compose file and Dockerfile that Portta can route, and then stops so
the person decides. It never publishes a port and never starts anything.

Start from the preflight (`portta agent context`). Use this skill when
`data.project.scope` is `needs-dockerizing`. For any other scope, do not
containerize anything.

## What you never do

- Write a `ports:` entry. Not for the web service, and above all not for a
  database or a cache. The gateway reaches the service on the shared network.
- Write Traefik labels, a `portta` network, `container_name` or an overlay.
  `portta adopt` generates all of that outside the project.
- Mount the Docker socket.
- Write or edit a file before the person approved the plan below.
- Reuse another environment's volume or give a volume a fixed `name:`.

## The flow

### 1. Read the project

Read `AGENTS.md`, `CLAUDE.md`, the `README` and the manifest (`package.json`,
`composer.json`, `Gemfile`, `pyproject.toml`, `go.mod`). Find the command that
starts the web server, the port it listens on, the runtime version, and what it
needs next to it: a database, a cache, a queue.

If you cannot tell which process serves HTTP, ask. Do not guess.

### 2. Propose, in words, before writing

Show the person what you would create, as a short list:

- the files: `compose.yaml` and `Dockerfile` (and `.dockerignore` if the project
  has none);
- the services, which one serves HTTP and on which container port;
- the datastores, and that they stay on the private network with no port;
- anything you could not infer.

Ask for approval. Wait for the answer. A "no" ends the skill.

### 3. Write the files

Only what was approved. The rules:

- **No `ports:` anywhere.** Use `expose:` only when it documents the port.
- **Listen on `0.0.0.0`**, not `127.0.0.1` or `localhost`, or the gateway cannot
  reach the service. Set it through the framework's host option or an
  environment variable in the start command, for example `--host 0.0.0.0`.
- **Name the web service plainly** (`web`, `app` or `api`), so Portta recognises
  it as the HTTP surface.
- **Databases and caches live only on the Compose network**, with a named
  volume for their data and no `ports:`. Reach them with
  `docker compose exec` or `portta db psql`, never by publishing.
- **Read credentials from the environment**, with a `.env.example` for the
  person to copy. Never write a real secret into a file.
- **Keep the Dockerfile small**: a pinned base image tag, dependencies before
  source for layer reuse, a non-root user when the runtime allows it, and the
  start command in `CMD`.

A minimal shape, adapted to the project:

```yaml
services:
  web:
    build: .
    environment:
      DATABASE_URL: postgres://app:${DB_PASSWORD}@postgres:5432/app
    depends_on:
      - postgres
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

[templates/overlays](https://github.com/codions-labs/portta/tree/main/templates/overlays)
in the Portta repository shows how the stacks Portta knows are wired. Use it as
a reference for service names and ports, not as something to copy labels from.

### 4. Check, then hand over

```
docker compose config --quiet
portta envs analyze . --json
```

`config --quiet` proves the file is valid. `analyze` is read-only and must show
no published port. If it does, remove the entry and run it again.

Then stop writing and follow the `portta-adopt-compose` skill from its
dry-run step: `portta adopt . --dry-run --json`. Do not run `docker compose up`
yourself: it skips the namespace and the overlay Portta generates.

### 5. Report

Say what you created, which service is the HTTP surface, that no port is
published, and that the next step is adoption, which needs the person's
decisions.
