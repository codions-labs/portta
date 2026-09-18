# 0035. The panel authenticates its own requests

**Status:** Accepted; see [0051](0051-authentication-is-optional-inside-a-trusted-network.md)

`PORTTA_AUTH_MODE=disabled` means every request is the local operator. It is
accepted under panel access `local`, `tailscale` and `vpn`, where the set of
people who can reach the panel is already an authenticated set, and refused at
boot under `domain` and `public`. The rule lives in `resolveSecurityMode`
(`packages/auth/src/security-mode.ts`) and nowhere else; the rationale is in
[ADR 0051](0051-authentication-is-optional-inside-a-trusted-network.md).
`required` uses panel-owned accounts, sessions, optional second factors and
personal API tokens. The first owner is created once through `/setup` or
`portta auth bootstrap`; later accounts are administered by an authorized
user.

Every protected API route declares a permission. Project-scoped operations are
checked again after the resource is resolved. Read-only mode removes mutations
from every principal. `PORTTA_AUTH_SECRET` signs sessions and tokens and is
never returned by the configuration API.

ForwardAuth remains a separate boundary for protected application hosts and
shares; it does not authenticate the panel.
