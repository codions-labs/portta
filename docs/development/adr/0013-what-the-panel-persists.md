# 0013. The panel persists decisions, not runtime observations

**Status:** Accepted; see [0037](0037-sqlite-is-the-panel-database.md)

One SQLite file stores Portta's durable model: instance identity, Projects,
environments and their settings, users, authorization grants, settings and
audit. It is
opened in process by the panel ([ADR 0037](0037-sqlite-is-the-panel-database.md)).

Docker owns container, network, mount, port, health and lifecycle facts.
Traefik owns active routers and services. Host collection owns machine
metrics. The panel reads those sources and does not copy their live state into
the database as another source of truth.

Durable mutations go through the API, which applies the same schema,
authorization and audit rules used by the panel. The CLI reaches
the panel's model through the API and never writes rows into the file.
