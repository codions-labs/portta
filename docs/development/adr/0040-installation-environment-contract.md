# 0040. The installation environment is the configuration contract

**Status:** Accepted; see [0037](0037-sqlite-is-the-panel-database.md), [0051](0051-authentication-is-optional-inside-a-trusted-network.md)

`.env.example` defines the supported installation keys and structure; `.env`
holds concrete values. The TypeScript configuration editor parses values
without executing them, rejects duplicates, preserves comments and unknown
operator extensions, generates missing secrets once and writes with mode 0600.

Persisted installation values win over inherited shell variables. Explicit CLI
choices are written before Compose is resolved. Host and panel writers share a
filesystem lock and keep the file inode stable for bind mounts.

Derived URLs and secrets are not persisted under additional names.

The panel's database is one file, named once by `PORTTA_RUNTIME_DATABASE_FILE`,
which Compose sets to the container path over a bind mount of
`$PORTTA_HOME/state/panel`; the CLI resolves the host path from `$PORTTA_HOME`
([ADR 0037](0037-sqlite-is-the-panel-database.md)). There is no database mode
and no connection URL to derive.

`PORTTA_AUTH_ALLOW_LAN` is an opt-in and not a secret, so it is written like
any other value; the rule that reads it is in the panel and in
`portta config set`, never in a compose file
([ADR 0051](0051-authentication-is-optional-inside-a-trusted-network.md)).
