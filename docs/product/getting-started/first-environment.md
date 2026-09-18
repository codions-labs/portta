# Configure your first environment

Use a local gateway and an existing Compose application you own. Install Portta
first using [Install Portta](install.md). The examples use an application in
`~/projects/demo-shop` with an HTTP service named `web`.

## Choose a namespace

Portta derives a Compose namespace from the checkout and branch, and passes it
with `docker compose -p`. A worktree therefore receives its own containers,
network and named volumes without editing the application's `.env`. On `main`,
`master`, `develop` or `development` the namespace is the checkout name alone
(`demo-shop`); on another branch the branch is appended (`demo-shop-issue-59`).

## Analyze the application

```bash
portta envs analyze ~/projects/demo-shop
```

The report is read-only. It names the Compose files it found, the services, the
HTTP service and port it infers, and any decision it cannot make alone (a fixed
container name, a shared network or volume).

## Adopt it

```bash
portta adopt ~/projects/demo-shop --dry-run
portta adopt ~/projects/demo-shop
```

`--dry-run` prints the Runtime Plan and the pending decisions without writing
anything. Review it: HTTP services join the shared gateway network while
databases remain on the application's private network. In auto mode, Portta
removes inherited host-port publications in its generated overlay; it does not
modify the application's Compose files. The plan and the overlay live in the
installation's own state.

If Portta cannot infer an HTTP service or its internal port, name it:

```bash
portta adopt ~/projects/demo-shop --service web:3000
```

## Start and verify

```bash
portta runtime up ~/projects/demo-shop
portta runtime status ~/projects/demo-shop
portta doctor
portta urls
```

Inside the project directory the short forms work too: `portta up`, `portta
status`, `portta logs` and `portta down` operate the runtime of the directory
you are in, preparing the plan first when it is missing or stale.

Use the URLs printed by Portta. A service named `web` under local hostname mode
uses `<namespace>-web.localhost`, such as `http://demo-shop-web.localhost`.

## See it in the panel

The panel is optional. Start it once, and open the environment from
**Projects → Environments on this host**:

```bash
portta web up
portta web open
```

With the default `PORTTA_AUTH_MODE=disabled` it opens without a sign-in on
`http://127.0.0.1:8081`. See [Use the web panel](../guides/web-ui.md).

## Next step

[Add your first project](first-project.md) to understand the relationship
between the running environment and its Project.
