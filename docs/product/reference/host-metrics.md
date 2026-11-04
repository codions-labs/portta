# Host metrics

The panel lives in a container. On macOS the chain is Mac → OrbStack or Docker
Desktop → a Linux VM → the panel. Anything the panel reads from `/proc`, the
Engine's `GET /info`, or `systeminformation` inside that container is the VM,
not the machine.

So collection runs on the host, the same way Git does.
The CLI talks to `systeminformation` and Docker, writes files under
`state/metrics`, and the panel only reads them. There is no Prometheus, no
Grafana, no privileged panel, and no extra `/proc` bind.

## What is collected

| Layer | Source | What it is |
|---|---|---|
| **Host** | `systeminformation` on the CLI process | The real machine: model, the chassis folded into a `kind` (notebook, desktop, server, vm), the commercial name on macOS (`productName`), OS, the time zone the clock is set to (`timezone`, `utcOffsetMinutes`), cores, RAM, load, the filesystem that holds `$PORTTA_ROOT` (on APFS, whose volumes share one container, what is in use is the container's size minus what is free), GPU, temperature and battery when the machine has them |
| **Runtime** | `docker info` `OperatingSystem` | A hint only: OrbStack, Docker Desktop, or the Engine. Never treated as the host |
| **Projects** | `docker stats` + Compose / `portta.project` labels | CPU and memory rolled up per project; Portta's own containers carry `own: true`, so a reading can tell them from the projects |
| **Docker disk** | `docker system df -v` on the CLI process, every five minutes | What each Compose project keeps: its named volumes and the writable layer of its containers (`dockerStorage`). Images are shared between projects and are not attributed; neither are files in a project's folder |
| **GPU memory** | `nvidia-smi` on the CLI process, every 15 seconds, Linux only | The memory in use and present on the NVIDIA GPUs (`gpuMemory`), and what each project's containers hold of it (`gpuMemoryBytes`), by tracing each GPU process to its container through `/proc/<pid>/cgroup`. Another make of GPU, or another system, gives no figure per project |
| **Containers** | The same `docker stats` | Per-container CPU, memory, network and block I/O |

`systeminformation`'s own Docker helpers talk to the engine socket in a way
OrbStack does not answer. Host facts stay with the library; Docker facts go
through the same `docker` CLI the rest of the gateway already uses.

A GPU utilisation of `0` without a utilisation field is stored as `null`. Zero
is only a reading when the source actually reported it.

On Linux the host and the Engine usually describe the same box. On macOS they
do not: the host card must show macOS, Apple silicon and the physical RAM;
OrbStack is a badge, not the machine.

## Files

```text
state/metrics/current.json     the latest snapshot (written atomically)
state/metrics/history.jsonl    one compact point every 15 seconds, kept 60 minutes
state/metrics/instance.json    a stable UUID for this gateway root
state/metrics/collector.pid    the detached watcher
state/logs/host-metrics.log    rotated at 256 KiB
```

The panel container mounts `state/metrics` read-only at
`/app/state/metrics`. A missing or unreadable file is an empty response,
never an error.

## Commands

| Command | Purpose |
|---|---|
| `portta host collect` | Write one metrics snapshot and one [environment readiness](host-readiness.md) report, then exit |
| `portta host watch` | Start the detached collector if it is not already running |
| `portta host watch --loop` | Run in the foreground (what the detached child does) |
| `portta host status` | Whether it is running, and how old the last snapshot is |

`--json` works on all four. Collection is every 5 seconds; a point older than
30 seconds is **stale**.

Readiness changes more slowly and is collected every five minutes. Use
`portta envs report` to refresh only that report.

The collector is a process on the host, so a reboot stops it and nothing starts it again until
`portta up`, `portta web up` or `portta host watch` does. That no longer leaves the Server page
showing old numbers on **Linux**: while the collector is not writing, the panel reads the server
itself, every three seconds (see [The panel's own reading](#the-panels-own-reading)). Where it
cannot (a Mac, behind Docker Desktop or OrbStack), the page keeps the last file, says how old it
is and that it is not the machine's state now, and dims it. After an upgrade the same commands
replace a collector that was started by an older build, so the new way of reading the machine takes
effect.

`portta up` and `portta web up` start the watcher. `portta down` and
`portta web down` stop it. If the gateway stays up after `web down`, the
Overview goes stale until the next `up`.

## The panel

`GET /api/metrics/current` is the latest snapshot plus `ageSeconds`, `stale`
and `collectorActive`. `GET /api/metrics/history?window=15m|30m|60m` is the
short history. Every snapshot uses the current metrics schema.

The Overview polls current every 5 seconds and history every 15. The project
page shows that project's containers from the same snapshot.

## The panel's own reading

On a Linux host the panel's container shares the kernel's view of memory, CPU, load and uptime
(`/proc/meminfo`, `/proc/stat`, `/proc/loadavg` and `/proc/uptime` are not namespaced), the state
folder it mounts is on the host's disk, and Docker answers for the machine (`/info`) and for each
container (`stats`, `system/df`) through the proxy the panel already owns. So the panel reads them
itself, with no new mount, no extra permission and no process on the host:

| What | Source | How often |
|---|---|---|
| Memory | `MemAvailable` in `/proc/meminfo` (what a program could still get, as `htop` counts it, not what is empty) | 3 s |
| CPU | the difference between two readings of `/proc/stat`, never the average since boot | 3 s |
| Load, uptime | `/proc/loadavg`, `/proc/uptime` | 3 s |
| Disk | the filesystem under the mounted state folder, read as `df` does | 3 s |
| Machine | Docker `/info`: name, distribution, kernel, architecture, cores | 60 s |
| Projects | Docker `stats` of each running container, in cores (a container on four of them reads 4), memory without the file cache | 10 s |
| Project disk | volumes and writable layers from Docker `system/df` | 5 min |

It is the floor under the collector, not a second opinion: while the collector writes (fresh within
30 seconds) its file is what the panel serves, because it reads what only the host can (git, project
files, a GPU, a battery) and the time zone. When it stops, the panel's reading takes over and keeps
those from the last file. The panel does **not** read where its container runs in a VM (Docker
Desktop, OrbStack, a Mac): there `/proc` is the VM's, and calling it the machine is the mistake this
whole design exists to avoid. Nothing here needs to be started again after a reboot, because Docker
brings the panel back.

The panel also keeps the last hour of its own readings in memory, so the charts are not empty after
the collector stopped. They are lost when the panel restarts.

## Why the collector still exists

The panel mounts no project directory, ships no host inventory library, and must not need
`--privileged` to tell the truth about the machine it is sitting on. What needs the host (git, the
files of a project, the folders to adopt, a GPU, a battery, a Mac) stays with the collector, the same
way Git does.
