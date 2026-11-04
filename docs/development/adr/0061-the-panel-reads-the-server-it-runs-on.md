# 0061. The panel reads the server's health itself where it can see the machine

**Status:** Accepted; see [0056](0056-the-collector-reads-where-the-code-stands.md)

## Context

The host metrics were written only by a collector process on the host, which `portta up`
starts. A reboot stops it and nothing starts it again, so the Server page kept showing the last
file it had, hours old and with a different uptime, as if it were the machine's state now. The
numbers on a server that had since restarted (98 % memory, load 90) were not what `htop` showed.

Another host-side service (systemd, launchd) would fix the restart and add a piece to install and
keep in step with the CLI. A separate monitoring container, as Dokploy runs, survives a reboot only
because Docker restarts it, and would still leave a Mac, where a container sees a VM, to the host.

## Decision

On a Linux host the panel reads the server itself, every three seconds. The kernel's `/proc/meminfo`,
`/proc/stat`, `/proc/loadavg` and `/proc/uptime` are not namespaced, so the panel's container already
reads the host's; the state folder it mounts is on the host's disk; and Docker answers for the machine
and for every container through the proxy the panel owns. No mount, no permission and no process is
added. The method is in [host metrics](../../product/reference/host-metrics.md).

The collector stays and **wins while it writes**: it reads what only the host can (git, project
files, discovered folders, a GPU, a battery, the time zone). The panel's reading is the floor under
it, used when the collector's file is older than the stale limit, and it keeps the host-only facts
from the last file.

The panel does not read where its container lives in a VM (Docker Desktop, OrbStack): there the
same files describe the VM. It decides that from Docker's own report of the engine, and when it
cannot be sure it reads nothing and the page says the numbers are old.

## Consequences

The Server page is live after a reboot on any Linux host with nothing to start. A Mac still needs
the collector, and says so when it is stopped.

This revisits "the panel never collects" in [ADR 0056](0056-the-collector-reads-where-the-code-stands.md)
for the host's own numbers, not for anything in a project's folder. The panel still imports no
host inventory library: it reads four `/proc` files and calls Docker.

A container's CPU is now in cores and unclamped (four busy cores read 4). It used to stop at one,
which is why a project on a loaded server could read 0.07 cores against a host at 99 %.

`packages/server/tests/live-metrics.test.ts` holds on to the parts that can be wrong without anyone
noticing: that available memory and not free memory is what is called used, that CPU is a
difference and not an average since boot, and that a VM is never read as the machine.
