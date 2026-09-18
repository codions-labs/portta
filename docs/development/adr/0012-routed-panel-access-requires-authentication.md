# 0012. Routed panel access requires authentication

**Status:** Accepted; see [0035](0035-authentication-lives-in-the-panel.md), [0051](0051-authentication-is-optional-inside-a-trusted-network.md)

The panel is loopback-only by default. `domain` and `public` require
`PORTTA_AUTH_MODE=required`, because they answer whoever finds the address.
`tailscale` and `vpn` may run without a login, because the network in front of
them already authenticates: an enrolled tailnet device, a VPN client. `local`
bound to an address that is not loopback is the one case the access mode does
not settle, and it needs `PORTTA_AUTH_ALLOW_LAN=true`.

In every mode: TLS where the route crosses an untrusted network, the panel's
own authorization checks on every request, and the Traefik dashboard on
loopback, never routed. The rationale for the two modes that run without a
login is in [ADR 0051](0051-authentication-is-optional-inside-a-trusted-network.md);
the list itself is `PANEL_ACCESS_WITHOUT_AUTH` in `packages/core/src/config.ts`.
