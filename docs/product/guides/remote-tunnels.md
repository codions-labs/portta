# Open remote tunnels

Reaching a VPS's private services from your machine, without opening a port on
the VPS.

```text
your Mac                    VPS
  client                    bridge (127.0.0.1:33077)
    |                          |
127.0.0.1:55432 ----SSH---->   |
                               v
                        project's private network
                               v
                          postgres:5432
```

## Opening one

```bash
portta remote access open deploy@vps \
  --project demo-shop --service postgres
```

```text
  id        7f2a91
  remote    demo-shop/postgres:auto
  via       deploy@vps
  local     127.0.0.1:55432
```

(`remote` shows the port you passed with `--port`, or `auto` when the gateway
picked it on the VPS, as above.)

Point TablePlus, DBeaver or `psql` at `127.0.0.1:55432`. The client never needs
to know the VPS exists.

```bash
portta remote access list
portta remote access close 7f2a91
portta remote access close --all
```

Closing the tunnel leaves the remote bridge in place, since another tunnel may
be using it, and prints the command to close that too.

## What it actually does

1. Runs `portta access open` **on the VPS**. That bridge binds the VPS's
   loopback, exactly as a local one does. It is never published.
2. Reads back the port it chose.
3. Opens `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>`.
4. Prints the local address and records the tunnel under `state/access/tunnels/`.

## Over Tailscale SSH

The same command; the target is a tailnet name:

```bash
portta remote access open deploy@dev-vps --project demo-shop --service postgres
```

Authentication and audit come from your tailnet policy instead of
`authorized_keys`, and no SSH port needs to be open on the internet.

## SSH options, and why

`StrictHostKeyChecking=accept-new` records a new host's key on first
connection and still refuses a *changed* one. That is the attack worth defending
against. It is never `no`. Override with `PORTTA_SSH_HOST_KEY_POLICY=yes` if you
pre-populate `known_hosts`.

`ExitOnForwardFailure=yes` means that if the local port turns out to be taken,
SSH exits instead of connecting successfully while forwarding nothing. The failure mode
that flag prevents is a tunnel that looks open and silently does not work.

`ServerAliveInterval=30` keeps the tunnel alive through a NAT idle timeout,
which is what usually kills a long-lived database session.

## Doing it by hand

Nothing here is magic:

```bash
ssh deploy@vps 'portta access open --project demo-shop --service postgres'
# note the port it prints, say 33077
ssh -N -L 127.0.0.1:55432:127.0.0.1:33077 deploy@vps
```

## Troubleshooting

**"the SSH tunnel exited immediately"** means the local port is taken, or the
host is unreachable. Try `--local-port` with a different number, or `ssh -v`.

**"the remote bridge did not report a port"** means the gateway on the VPS is
not where we looked. Pass `--dir` if it is not in `~/portta`, and check
`portta remote status deploy@vps`.

**The tunnel dies after a while.** That is a NAT or firewall idle timeout.
`ServerAliveInterval` covers the usual cases; a very aggressive middlebox may
need a shorter one in your `~/.ssh/config`.

**Connection refused through a working tunnel.** The remote bridge is gone.
`portta remote exec deploy@vps -- portta access list`.
