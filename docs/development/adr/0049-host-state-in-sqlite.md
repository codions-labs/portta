# 0049. Host daemon state lives in SQLite under `PORTTA_HOME/state/host`

**Status:** Accepted; see [0013](0013-what-the-panel-persists.md), [0037](0037-sqlite-is-the-panel-database.md)

## Context

The host daemon ([ADR 0047](0047-host-daemon-and-panel-proxy.md)) keeps state
the panel's database cannot: which worktrees exist, which terminal sessions and
agent runs are alive, their events and transcripts. That state is written as
processes on the host change, often many times a second, and it must survive a
panel that is stopped, restarted or not installed at all.

[ADR 0013](0013-what-the-panel-persists.md) and
[ADR 0037](0037-sqlite-is-the-panel-database.md) make the panel's durable model
one SQLite file and keep live runtime facts with the system that owns them.
This record says what the daemon keeps, and why it is separate from the
panel's file even though both are SQLite on the same host.

## Decision

**The daemon's state lives under `$PORTTA_HOME/state/host/`, in SQLite, and is
owned by the daemon alone.**

- One directory for the daemon, beside the collectors' `state/*` directories
  ([ADR 0020](0020-installer-and-portta-home.md)): `token`, and per module a
  database `<id>.db` plus the directories its processes need (run logs, a
  supervisor socket). The daemon reads nothing it finds there but `token` and
  its own files.
- SQLite in WAL mode, through `better-sqlite3`, left external to the CLI bundle
  as a native dependency. Each module migrates its own schema at daemon start.
- The panel mounts nothing here but `token`, read-only, and opens no database.
  It reads the daemon's state through the daemon's API, the way it reads Docker
  through Docker's.
- What the panel persists stays in the panel's own database. A link between the
  two — an issue and the run working on it, a session and the worktree behind
  it — is stored by the panel as the daemon's identifier, and resolved through
  the API.

## Two databases, two owners

- **`state/host/<id>.db` belongs to the daemon and `state/panel/portta.db`
  belongs to the panel.** They are separate files in separate directories with
  separate lifetimes and separate backups, and neither process opens the
  other's. A shared directory was rejected for exactly this reason.
- **The daemon never reads the panel's model.** It has no reason to: it holds
  no user, role or permission ([ADR 0047](0047-host-daemon-and-panel-proxy.md)),
  and everything it is asked to do arrives as a request the panel already
  authorised.
- **The CLI may open the panel's file, because it is a file on the host.**
  That capability is bounded to operations on the installation — applying
  migrations, copying the file for a backup, opening a shell — and never to
  writing the model, which goes through the API so that the same schema,
  authorisation and audit rules apply
  ([ADR 0013](0013-what-the-panel-persists.md)).
- **Both databases make the same durability trade**, WAL with
  `synchronous = NORMAL`.

## Consequences

- The execution runtime keeps working with the panel off, and a panel restart
  loses nothing a run needs.
- The daemon's database is host runtime state in ADR 0013's sense: it is owned
  by the system that produces it and is not copied into the panel's database.
- `portta backup` and `restore` must learn `state/host` when the first module
  stores something worth restoring there.
- A module's state is removed by removing its files; turning the module off
  leaves them in place.

## Note

Taskflow, the first module to store state here, keeps `taskflow.db` (SQLite),
`projects.json` (its Project registry), `runs/` (workflow journals and
transcripts), `workflows/` (the user workflow catalog), and
`runtime/supervisor.sock` with `runtime/supervisor.sqlite` for its ACP
supervisor. `PORTTA_HOST_STATE_DIR` overrides the directory, which defaults to
`$PORTTA_HOME/state/host`.
