# 0021. Panel access is an explicit decision

**Status:** Accepted; see [0027](0027-forward-authentication-service.md), [0035](0035-authentication-lives-in-the-panel.md), [0051](0051-authentication-is-optional-inside-a-trusted-network.md)

The panel access modes are `local`, `tailscale`, `vpn`, `domain` and `public`.
`local` binds loopback. `domain` and `public` require panel authentication,
because they answer whoever finds the address; `tailscale` and `vpn` may run
without it, because the network in front of them authenticates on its own
([ADR 0051](0051-authentication-is-optional-inside-a-trusted-network.md));
`local` on a non-loopback bind needs `PORTTA_AUTH_ALLOW_LAN=true` on top.
`PANEL_ACCESS_WITHOUT_AUTH` in `packages/core/src/config.ts` is the list.
Every mode is validated against the selected gateway profile. Routed modes
default to read-only unless the operator deliberately enables writes.

The browser origin is recorded in `PORTTA_PANEL_URL`; additional trusted
origins are explicit. The Traefik dashboard is separate from the panel and
always remains on loopback.
