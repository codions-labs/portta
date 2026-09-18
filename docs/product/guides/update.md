# Update Portta

## Update an installation

Update the package, then run setup again from the installation's host:

```bash
npm install -g @codions/portta
portta setup
```

Setup finds the existing installation and, after one confirmation:

1. replaces the runtime assets — `bin/portta`, `VERSION`, `.env.example`,
   `docker/`, `scripts/`, `templates/` and the `runtime/` copy — with the ones
   from the new npm package;
2. copies a default file into `config/traefik/dynamic/` only when that file does
   not exist, and leaves the rest of `config/` alone;
3. reconciles `.env` with the new `.env.example`: keys the new release adds are
   appended with their defaults, and every value already set is kept.
   `PORTTA_AUTH_SECRET` is generated only when it is empty;
4. creates any missing state directory, ensures the shared network, pulls the
   pinned images and starts the gateway with `docker compose up -d --wait`.

`state/` is never replaced, so the panel database, ACME material and the
Tailscale identity survive. The panel applies pending database migrations when
it starts.

To see the plan without changing anything:

```bash
portta setup --dry-run
```

To pin a version, name it in the package specifier, as in
[Install Portta](../getting-started/install.md).

## Recreate with the current images

`portta update` works inside an installation without fetching a new runtime: it
reconciles `.env`, validates the Compose model, pulls the pinned images, asks
for confirmation and recreates the gateway components.

```bash
portta update
```

Take a backup first when the update matters: [Back up and restore the panel](backup-restore.md).
