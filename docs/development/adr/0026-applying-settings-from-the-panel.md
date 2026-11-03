# 0026. Applying panel settings uses one isolated applier

**Status:** Accepted

Settings that affect Compose take effect through one stopped, fixed-command
container prepared by the CLI when `PORTTA_APPLY=true`. The panel may start
that container but cannot choose its command or arguments.

The applier runs the installed Node CLI, mounts only the Docker socket and the
installation directory, has no network, and is not part of the Compose project
it recreates. Its specification label lets `portta up` replace a stale shape
and preserve the exit status of the current run. Public panel modes do not
prepare it.

## What "pending" means

A saved setting is pending when `.env` differs from the `.env` the last
successful `portta up` (or `restart`, `update`) was given. `up` records it in
`state/panel/applied-env.json` (secrets as a digest only), and the panel
compares the two snapshots of the same file.

Comparing `.env` with the panel's own environment is not sound: the CLI derives
the domain, the bind address and the profile before handing them to Compose, so
for those keys the two never agree and no `up` can clear the alert. Without the
record (an installation that has not run `up` since it existed) the panel falls
back to that comparison.
