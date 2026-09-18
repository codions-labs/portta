# Back up and restore the panel

Two mechanisms cover different needs: `portta backup` archives the whole
installation for disaster recovery, and `portta db dump` writes only the panel
database, for moving it independently of `.env`, `config/` and `state/`.

> [!CAUTION]
> Restoring replaces what is there. Confirm the target installation and retain a current backup before continuing.

## What the panel database is

One SQLite file, `$PORTTA_HOME/state/panel/portta.db`, opened in process by the
panel ([Persistence](../concepts/persistence.md)). There is no server to connect
to, no credential to keep beside a dump, and no cluster whose configuration can
drift from `.env`.

> [!NOTE]
> In WAL mode that file is three: `portta.db`, `portta.db-wal` and
> `portta.db-shm`. Anything that copies or moves the database moves all three —
> copying only the first is how a backup silently loses the most recent writes.
> Every Portta command that touches the database already does this; the note is
> for anybody reaching for `cp`.

Check the database before continuing:

```bash
portta db status
```

## Back up the installation

Archive everything this installation cannot regenerate: `.env`, `VERSION`,
`config/` and `state/`, plus a consistent copy of the panel database taken with
SQLite's `VACUUM INTO`. The copy needs `sqlite3` on the host; without it, or
before the panel has ever started, the archive is written without the database
and the command warns.

```bash
portta backup
portta backup -o /path/to/portta-backup.tar.gz    # choose the destination
portta backup --no-database                       # leave the database out
```

```text
backup written
  file      portta-backup-20260912T120000Z.tar.gz
  size      42.1M
  contents  4 path(s) + database
```

The archive contains credentials — `.env`, the panel's password hashes and any
tokens — so it is written with a private mode. Store it with the same care as
the installation itself. Anything `portta setup` installs again from the npm
package (`bin`, `scripts`, `docker/`) is deliberately left out, so restoring
never downgrades the running code.

## Restore the installation

```bash
portta restore portta-backup-20260912T120000Z.tar.gz
```

Restoring over a running gateway is refused by default, because the containers
would keep running with credentials the restore just replaced:

```bash
portta down
portta restore portta-backup-20260912T120000Z.tar.gz
portta up
portta doctor
```

Pass `--force` to restore under a running gateway instead. Whatever the restore
replaces is copied first into `state/restore-<timestamp>/`, so an archive that
turns out to be the wrong one is recoverable.

## Back up only the panel database

```bash
portta db dump                      # writes portta-<timestamp>.db
portta db dump panel-backup.db      # or a file you name
```

The command runs on the host and needs `sqlite3`. It uses SQLite's `.backup`, so
it is safe while the panel runs and the file includes the most recent writes.
Retain the installation's `.env` with it: the session secret that signs every
token is there and not in the database, so a database restored beside a
different `.env` signs everybody out. Store both with restricted access.

## Restore only the panel database

Restoring is refused while the panel runs, because replacing the file under an
open connection corrupts what the panel has open. Stop the panel, restore, and
start it again:

```bash
portta web down
portta db restore panel-backup.db
portta web up
```

`db restore` takes a file argument and asks for confirmation before it discards
the current panel data; pass `--yes` to confirm non-interactively. It removes the
old `-wal` and `-shm` files so SQLite does not read old writes back over the
restored database.

Keep the previous backup until you have verified the restored installation.
Afterwards, open the panel and check its Projects, users and settings.

These commands operate on the **panel database** only. For a Project's own
PostgreSQL, MySQL or Redis, use
[Connect to project databases](database-access.md).

## Migrations and version skew

A database restored from an older installation may be behind the schema the
running panel expects. `portta db migrate` applies what is pending without a
restart; the panel also applies pending migrations at boot, under a lock, before
it opens HTTP ([Develop the database schema](../../development/database-development.md)).

The reverse — a database from a *newer* installation, restored under older code
— is not supported. Restore it under the version it came from, or upgrade first.

See [Persistence](../concepts/persistence.md) for state ownership and lifecycle.
