# Deploy Portta on a server

A manual guide, run by you, on a server you control. It contains no real
addresses: replace `example.com` and `203.0.113.10` with your own.

## 1. Requirements

- Node 24 or newer, npm, Docker Engine 24 or newer with Compose 2.24.4 or newer.
- `sqlite3` (for `portta db shell` and backups).
- Ports 80 and 443 free on the host. If another proxy or web server uses them,
  stop it first or Portta cannot start.
- A domain with a wildcard DNS record `*.example.com` pointing at the server,
  DNS only, and a DNS API token restricted to the zone.

## 2. Install

```bash
npm install -g @codions/portta@<version>
portta setup
```

Old installations are not updated for you. Check `portta version` afterwards.

## 3. Configure

Edit `~/portta/.env` following [Run a public host](public-host.md). Then:

```bash
portta up remote-public
portta doctor
```

`doctor` must pass with no failures: it checks DNS, the auth service and the
certificate. Open `https://example.com` and create the owner account.

## 4. Teach your agents

```bash
portta agents install
```

Codex asks you to approve the session hook the first time: open `/hooks` in a
session and approve it.

## 5. Adopt a project that already runs

Adopting changes how a project runs, so do it carefully:

1. Dump every database first, outside the host.
2. Run `portta adopt /path/to/project --dry-run` and read it. The Compose project
   name (the namespace) must not change: a different namespace means new volumes
   and an empty database.
3. Tools that used `127.0.0.1:3306` move to `portta db` or `portta access`.
4. Decide for each routed service: `--protect` or `--public`.
5. `portta runtime up /path/to/project`.

## 6. Back up

```bash
portta backup
```

Schedule it (cron or a systemd timer) and copy the result off the host.

## 7. Acceptance checklist

- [ ] `portta doctor` passes.
- [ ] The certificate is valid in a browser, for the panel and for a project.
- [ ] After a reboot, the gateway and projects come back.
- [ ] A protected site asks for a login and rejects a wrong password.
- [ ] A database is not reachable from the internet or from another project.
- [ ] The panel asks for a login and the owner has two-factor authentication.
- [ ] A link or login for a client works from your phone.
- [ ] Three projects run in parallel with different hostnames.
