# Install Portta

Install the gateway from the published npm package. No repository checkout is
needed.

## Requirements

- Node 24 or newer, including npm;
- Docker Engine 24 or newer with Docker Compose 2.24.4 or newer;
- a POSIX host and shell.

Setup does not install those prerequisites or request elevated privileges. It
tells a missing `docker` command apart from a Docker daemon that does not
answer, so the message names the thing to fix.

## Install

```bash
npm install -g @codions/portta
portta setup
```

Portta is an npm package, so this needs Node 24+ and nothing else. To run setup
once without installing the command globally:

```bash
npx @codions/portta setup
```

`latest` is the release channel, so no tag needs naming. Setup checks Node,
Docker and Compose, asks one confirmation naming the installation directory
(`~/portta` by default), and then:

1. installs the runtime into the installation directory;
2. prepares `.env` from `.env.example`, keeping any value already set and
   generating `PORTTA_AUTH_SECRET` when it is empty;
3. creates the state directories and the shared Docker network;
4. pulls the pinned images and starts the gateway on the `local` profile.

It does not enable the panel. `.env.example` ships with `PORTTA_WEB=false`,
`PORTTA_WEB_EXPOSE=local` and `PORTTA_AUTH_MODE=disabled`.

Setup ends by printing where it installed, how to start the panel
(`portta web up`) and how to check the installation (`portta doctor`).

To install a specific published version or choose a directory:

```bash
npx @codions/portta@0.1.0 setup --dir /opt/portta --yes
```

Use `--dry-run` first when automating:

```bash
npx @codions/portta setup --dir /opt/portta --profile local --dry-run --json
npx @codions/portta setup --dir /opt/portta --profile local --yes
```

## Where `portta` finds the installation

The command you run afterwards is the globally installed `portta`. From any
directory it looks for an installation in `PORTTA_HOME`, then `~/portta`,
`/opt/portta`, `~/.portta` and `/var/lib/portta`, after first walking up from
the current directory. With the default directory nothing else is needed. When
you chose another directory with `--dir`, export it once:

```bash
export PORTTA_HOME=/opt/portta
```

Setup prints that line when it applies. The `bin/portta` copy inside the
installation serves the applier; it is not the command you run.

## Installation directory

The directory contains the current release runtime and the host's state:

```text
<installation>/
├── VERSION
├── .env
├── .env.example
├── bin/portta
├── docker/
├── scripts/
├── templates/
├── config/
├── state/
└── runtime/
```

`.env`, `config/` and `state/` are preserved on repeated setup; the runtime
assets are updated from the npm package. Setup refuses a non-empty directory
that is not a Portta installation. See [Update Portta](../guides/update.md).

## Check the gateway

```bash
portta status
portta doctor
```

## Enable the panel

The panel is optional and off until you start it:

```bash
portta web up
portta web open      # http://127.0.0.1:8081
```

`web up` writes `PORTTA_WEB=true`, so later `portta up` runs start the panel
too. It listens on loopback, and with the default `PORTTA_AUTH_MODE=disabled`
there is no sign-in: whoever reaches `127.0.0.1:8081` on this machine is the
local operator.

## Choose authentication

Decide before the panel is reachable from anywhere but this machine.

| You want | Run |
|---|---|
| A panel only you use, on this machine or over your tailnet or VPN | keep `disabled` (the default) |
| Accounts, roles, tokens and an audit log — or any public or domain access | `portta config set panel.auth required` |

To turn sign-in on and reach the panel on the gateway's own domain, which also
needs TLS and a panel hostname (`portta config set panel.host`):

```bash
portta config set panel.auth required
portta web up --expose domain
```

A panel with `required` and no owner prints where to create one. Open `/setup`
once to create the owner, or create it from the host:

```bash
printf %s "$PASSWORD" | portta auth bootstrap \
  --name 'Ada Lovelace' --email ada@example.com --password-stdin
```

`public` and `domain` access refuse to start while authentication is disabled.
Project exposure remains a separate, explicit decision.

See [Use the web panel](../guides/web-ui.md#reaching-it),
[Configure authentication](../guides/authentication.md), the
[installation reference](../reference/installation-reference.md) and
[configuration](../reference/configuration.md).
