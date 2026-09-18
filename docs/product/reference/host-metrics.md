# Host metrics

The panel lives in a container. On macOS the chain is Mac → OrbStack or Docker
Desktop → a Linux VM → the panel. Anything the panel reads from `/proc`, the
Engine's `GET /info`, or `systeminformation` inside that container is the VM,
not the machine.

So collection runs on the host, the same way [Git does](../../development/adr/0010-git-collected-on-the-host.md).
The CLI talks to `systeminformation` and Docker, writes files under
`state/metrics`, and the panel only reads them. There is no Prometheus, no
Grafana, no privileged panel, and no extra `/proc` bind.

## What is collected

| Layer | Source | What it is |
|---|---|---|
| **Host** | `systeminformation` on the CLI process | The real machine: model, the chassis folded into a `kind` (notebook, desktop, server, vm), the commercial name on macOS (`productName`), OS, cores, RAM, load, the filesystem that holds `$PORTTA_ROOT`, GPU, temperature and battery when the machine has them |
| **Runtime** | `docker info` `OperatingSystem` | A hint only: OrbStack, Docker Desktop, or the Engine. Never treated as the host |
| **Projects** | `docker stats` + Compose / `portta.project` labels | CPU and memory rolled up per project |
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
`portta envs report` to refresh only that report. The same watcher runs
`portta repos scan` once a minute.

`portta up` and `portta web up` start the watcher. `portta down` and
`portta web down` stop it. If the gateway stays up after `web down`, the
Overview goes stale until the next `up`.

## The panel

`GET /api/metrics/current` is the latest snapshot plus `ageSeconds`, `stale`
and `collectorActive`. `GET /api/metrics/history?window=15m|30m|60m` is the
short history. Every snapshot uses the current metrics schema.

The Overview polls current every 5 seconds and history every 15. The project
page shows that project's containers from the same snapshot.

## Why it is not in the panel

The same refusals as Git: the panel mounts no project directory, ships no
host inventory library, and must not need `--privileged` to tell the truth
about the machine it is sitting on.
