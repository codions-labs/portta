# Prepare a remote host

```bash
portta remote bootstrap deploy@vps.example.com --profile remote-private
```

Prepares a host to run the gateway from a Git checkout of the repository: it
clones the repository on the remote host and runs the checkout's
`./bin/portta bootstrap`. Idempotent: run it again to update. The npm install
is the other way to prepare a host, over SSH by hand:
`npm install -g @codions/portta && portta setup`.

## What it does

1. Connects over SSH and reports the distribution and architecture.
2. Checks Docker and Compose. If Docker is missing it stops, unless
   `--install-docker` is given.
3. Clones the repository, or fast-forwards an existing checkout.
4. Creates `.env` from the example **only if absent**, and sets the profile.
5. Runs `bootstrap` on the host.
6. Offers to start the gateway, then runs `doctor` and `urls`.

## Flags

| | |
|---|---|
| `--profile <name>` | Profile to configure (default `remote-private`) |
| `--dir <path>` | Install location (default `~/portta`) |
| `--repo <url>` | Repository (default: this checkout's `origin`) |
| `--branch <name>` | Branch (default `main`) |
| `--install-docker` | Offer to install Docker when missing |
| `--dry-run` | Print what would happen, change nothing |

## Rules it keeps

**An existing `.env` is never overwritten.** It holds the host's secrets and
its configuration. If it is there, it is left exactly as it was.

**No secrets are transferred.** `TS_AUTHKEY`, `ACME_EMAIL` and
`CF_DNS_API_TOKEN` are set on the host, by you:

```bash
ssh deploy@vps.example.com 'nano ~/portta/.env'
```

**Host key verification stays on.** SSH runs with
`StrictHostKeyChecking=accept-new`: a new host's key is recorded on first
connection, but a *changed* key is still refused, which is the case worth
defending against. It is never set to `no`. Override deliberately with
`PORTTA_SSH_HOST_KEY_POLICY=yes` if your workflow pre-populates `known_hosts`.

**`curl | sh` is never silent.** With `--install-docker`, the gateway says
plainly that it is about to run Docker's official installation script as root
on the remote host, and asks. Without the flag it stops and points at the
manual steps below.

## Installing Docker by hand

Preferred over the convenience script for anything long-lived:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker "$USER"   # log out and back in
```

Note that adding a user to the `docker` group is equivalent to giving them
root, because the Docker API is not namespaced. Use a dedicated deployment
user.

## Over Tailscale SSH

With Tailscale SSH configured, the same commands work, with the target being
the tailnet name:

```bash
portta remote bootstrap deploy@dev-vps --profile remote-private
```

Authentication and audit then come from your tailnet policy rather than from
`authorized_keys`.

## Driving the host afterwards

```bash
portta remote status deploy@vps.example.com
portta remote doctor deploy@vps.example.com
portta remote urls   deploy@vps.example.com
portta remote exec   deploy@vps.example.com -- docker ps
```

## Troubleshooting

**Cannot connect.** Check the host, your key, and whether the host key is
accepted. `ssh -v deploy@host` says more than the wrapper does.

**"docker: command not found" although it is installed.** A non-interactive SSH
session uses a shorter `PATH`. Check `ssh host 'command -v docker'`.

**Permission denied talking to the Docker daemon.** The user is not in the
`docker` group, or the session predates being added. Log out and back in.
