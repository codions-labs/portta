# Open a console in a project container

Open an environment, choose a running service and select **Console**. The panel
opens an interactive `/bin/bash` session when available and falls back to
`/bin/sh`. Images with neither shell show a readable error.

The console runs as the image's configured user. It is never privileged and
does not accept a user or command override. Use it to inspect the environment,
application configuration, service DNS and tools already shipped in the image.
It is not a host shell and cannot enter Portta's own gateway containers.

Only owners and administrators hold `container:console`. Developers may still
start, stop and restart project containers but do not receive a shell by
default; viewers never do. Agents do not receive this permission by default
either. With authentication disabled, every request that is not an agent is the
local operator, who holds it.

Close the console when finished. It also closes after 15 minutes without input
or output and has a two-hour maximum. Portta interrupts the foreground command,
exits the fixed shell and verifies the Docker exec state before releasing its
connection. Opening and closing are audited with principal, project, container
and duration. Commands and output are not recorded.

The shell can read everything its container can read, including environment
secrets and writable mounts. Treat access to the panel accordingly: keep a panel
that others can reach behind `PORTTA_AUTH_MODE=required` or a private network
you trust ([Authentication](authentication.md)).
