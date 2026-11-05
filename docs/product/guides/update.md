# Update Portta

## Update an installation

Update the package, then run setup again from the installation's host:

```bash
npm install -g @codions/portta
portta setup
```

Setup finds the existing installation and, after one confirmation:

1. replaces the runtime assets (`bin/portta`, `VERSION`, `.env.example`,
   `docker/`, `scripts/`, `templates/` and the `runtime/` copy) with the ones
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

## Migrate generated hostnames in 0.7.0

Version 0.7.0 replaces generated names such as `shop-web.example.com` with
`shop--web.example.com`. Existing projects must migrate; old generated URLs
have no compatibility alias or redirect. The Compose namespace, networks,
volumes and application data keep their existing identities. The panel's
configured domain and explicit custom domains are separate from this convention.

Install the exact published package first, without running setup yet. The
following example updates an installation at `/root/portta` that already uses
`remote-public`; use the installation's actual directory and current profile.
Setup defaults to `local` if no profile is supplied.

```bash
npm install -g @codions/portta@0.7.0
cd /root/portta
portta --profile remote-public migrate hostnames --json
portta --profile remote-public backup --output /root/portta-before-0.7.0.tar.gz
```

The migration command previews its old/new URL map and affected files without
writing anything. Resolve collisions or ownership errors before continuing.
Capture which application services are running, their image IDs, Compose file
lists, namespaces and volume identities before the cutover.

The regular backup contains configuration and state, including a consistent
panel database. It does **not** contain `runtime/compose` or application
checkouts. Keep a private supplementary copy of the Runtime Plans, generated
overlays and any application configuration you will change. These files can
contain credentials; do not put the backups in Git or print their contents.
The migration also saves the files it changes and a journal under
`state/migrations/hostnames/`, with restricted permissions.

Stop the panel before applying so it cannot write access decisions at the same
time. `web down` stops the panel and its socket proxy; it does not stop the
gateway, authentication service or applications. Apply the new access decisions
and saved routes before setup activates the new gateway rule:

```bash
portta --profile remote-public web down
portta --profile remote-public migrate hostnames --apply --json
portta --yes --profile remote-public setup --dir /root/portta
```

The migration preserves public/protected choices, usernames and password hashes.
Sessions tied to a changed hostname must sign in again. A failure between access
state and routing leaves a protected service closed; do not remove ForwardAuth
to bypass the cutover. The migration itself never starts an application.

Update application base URLs and any matching redirect or origin configuration
that reference a retired hostname, such as Laravel's `APP_URL`. Recreate only
previously running services whose labels or configuration changed, using their
saved Compose namespace and file list. Keep their current images with
`docker compose up -d --no-deps --no-build --pull never <affected-services>`.
Leave stopped environments stopped. Do not rebuild unrelated work in progress,
rename namespaces, remove volumes or use `down -v` for this migration.

Finally, verify the installation and preview again:

```bash
portta --profile remote-public doctor
portta --profile remote-public urls
portta --profile remote-public migrate hostnames --json
```

Check the new HTTPS endpoints and certificates, the expected public or protected
behavior, and that retired URLs no longer serve the applications. Compare
namespaces and volume identities with the captured inventory. A second
migration preview should report no changes. If the cutover must be rolled back,
restore the previous package/runtime, configuration, access decisions and saved
Runtime Plans together; the regular backup alone does not restore the plans.

## Recreate with the current images

`portta update` works inside an installation without fetching a new runtime: it
reconciles `.env`, validates the Compose model, pulls the pinned images, asks
for confirmation and recreates the gateway components.

```bash
portta update
```

Take a backup first when the update matters: [Back up and restore the panel](backup-restore.md).

## Refresh the agent layer

Setup does not touch the files `portta agents install` wrote for Claude Code,
Codex, OpenCode and Pi. After updating the package, compare and rewrite the
difference:

```bash
portta agents status
portta agents install
```
