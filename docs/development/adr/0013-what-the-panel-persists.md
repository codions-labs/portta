# 0013. The panel persists decisions, not runtime observations

**Status:** Accepted; see [0037](0037-sqlite-is-the-panel-database.md), [0049](0049-host-state-in-sqlite.md), [0050](0050-work-lives-in-an-external-provider.md)

One SQLite file stores Portta's durable model: instance identity, Projects,
repositories, environments and their settings, work sessions, users,
authorization grants, SSH keys, settings, audit and bounded activity. It is
opened in process by the panel ([ADR 0037](0037-sqlite-is-the-panel-database.md)).

Docker owns container, network, mount, port, health and lifecycle facts.
Traefik owns active routers and services. Host collection owns Git and machine
metrics. The panel reads those sources and does not copy their live state into
the database as another source of truth.

Durable mutations go through the API, which applies the same schema,
authorization and audit rules used by the panel and MCP server. The CLI reaches
the panel's model through the API and never writes rows into the file;
[ADR 0049](0049-host-state-in-sqlite.md) draws the line between the panel's
file and the host daemon's.

An issue lives in GitHub or in Linear. What the panel persists about it is a
reference (`github:owner/repo#113`) on the environment, session and activity
rows that concern it, and the issue itself is read at request time
([ADR 0050](0050-work-lives-in-an-external-provider.md)). A projected issue is
not a third category of persistence, because it is not persisted at all.
