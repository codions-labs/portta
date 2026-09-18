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
