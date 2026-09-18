# 0051. Authentication is optional inside a network that already authenticates

**Status:** Accepted; see [0012](0012-routed-panel-access-requires-authentication.md),
[0021](0021-panel-access-modes.md), [0035](0035-authentication-lives-in-the-panel.md)

## Context

The panel is loopback-only by default
([ADR 0012](0012-routed-panel-access-requires-authentication.md)), and
`PORTTA_AUTH_MODE=disabled` represents the local operator
([ADR 0035](0035-authentication-lives-in-the-panel.md)). The simplest rule
would be that *any* access mode reachable from another machine requires
`PORTTA_AUTH_MODE=required`, enforced by refusing to boot otherwise.

That rule is right about `public` and `domain` and wrong about the two modes in
between. `tailscale` binds the panel to the node's tailnet address and nothing
on the public NIC; `vpn` routes it at a private hostname that is only resolvable
and only reachable inside the VPN. In both, reaching the panel at all requires
having already authenticated: a tailnet address answers a device somebody
enrolled and an ACL admits, and a VPN client is a credential that was issued and
can be revoked. Requiring a second login there does not close anything that was
not already closed — it adds a password to a door that is inside a locked
building.

The cost of getting this wrong is not theoretical. An operator running Portta on
their own machine, reached over their own tailnet, was told to configure a
session secret, create an owner through `/setup`, and then sign in every time —
to a panel that only they can reach, on a host they already have a shell on. The
predictable result is `PORTTA_WEB_EXPOSE=local` with a non-loopback bind
address, which is the one configuration that genuinely is open, arrived at by
accident while trying to avoid a login that was never protecting anything.

The one case the access mode does not settle is exactly that one: `local` bound
to something other than loopback. "Everyone on the office Wi-Fi", "everyone in
the hotel", "everyone on this cloud provider's shared network" is not an
authenticated set, and the access mode says nothing about it because `local`
describes intent rather than reach.

## Decision

> **`PORTTA_AUTH_MODE=disabled` is accepted wherever the set of people who can
> reach the panel is already an authenticated set, and refused at boot where it
> is not. The access mode is what decides which of the two it is.**

### The list, and where it lives

`PANEL_ACCESS_WITHOUT_AUTH` in `packages/core/src/config.ts` is `local`,
`tailscale`, `vpn`, and `allowsDisabledAuth()` is the only way anything asks.
`public` and `domain` are absent: they answer whoever finds the address, and the
panel is what stands in front of the panel there.

The rule is implemented once, in `resolveSecurityMode`
(`packages/auth/src/security-mode.ts`). Everything else in the panel reads a
`Principal` and never asks what mode the process is in — that separation is why
this is a change to one function rather than to every route.

### The LAN needs to be said out loud

`local` with a bind address that is not loopback requires
`PORTTA_AUTH_ALLOW_LAN=true`. Without it the panel refuses to start, with a
message that names the bind address and offers both ways out. The variable is
named for what it admits rather than for what it disables, so an operator
chooses it rather than arrives at it, and so that reading a `.env` afterwards
answers the question "did somebody mean this?".

`required` is unchanged and still demands `PORTTA_AUTH_SECRET`.

### The refusal arrives in the terminal, not at the next boot

The two settings are made in either order, so `portta config set panel.auth` and
`portta config set panel.access` each validate against the other
(`packages/cli/src/commands/config.ts`). Turning the login off under an access
mode that answers the world is refused with the command that fixes it; turning
it off on `tailscale` or `vpn` is allowed and prints what it now means, that
anybody who reaches the panel over the tailnet or the VPN is the local operator.
Changing access *to* `public` or `domain` while the panel answers everybody as
the local operator is refused the same way.

### `doctor` grades the same rule in three levels

`panelAuthVerdicts` (`packages/core/src/diagnostics.ts`) fails where the panel's
own process would refuse to start, so a failure there is a host that will not
come up rather than a host that is quietly open: `public` or `domain` without a
login, and `local` on a LAN address without the opt-in.

Everything Portta does accept is reported as a **warning** rather than silence,
because "no login" should never be invisible. A tailnet or VPN panel with no
login warns and names the assumption. A LAN panel with `PORTTA_AUTH_ALLOW_LAN`
warns and names the bind address. Only a loopback panel, and a panel that signs
people in, pass.

## Consequences

- A single-operator installation reached over a tailnet is a first-class,
  supported configuration with no accounts, no session secret and no `/setup`.
  That is the common case, and it is now the cheap one.
- The security of such an installation is the tailnet's or the VPN's. A tailnet
  ACL that admits a device admits an operator; a stolen VPN profile is a stolen
  panel. Portta says so in `doctor` rather than implying a boundary it does not
  enforce.
- There is no per-user attribution without accounts. Activity, sessions and
  audit record the local operator, and an installation that needs to know *who*
  needs `required` — which is the same trade
  [ADR 0035](0035-authentication-lives-in-the-panel.md) always described.
- The dangerous configuration is now the one that is hard to reach by accident.
  Binding the panel to a LAN address without a login takes a named variable, and
  every other reachable-without-login combination is one the access mode already
  vouches for.
- One more variable in the installation contract
  ([ADR 0040](0040-installation-environment-contract.md)), and one more thing
  `doctor` can warn about. Both are the price of the rule being explicit rather
  than implied by a bind address.
- [ADR 0038](0038-roles-and-project-access.md) is unaffected in `required` mode
  and inert in `disabled` mode, where there is one principal and it holds
  everything.
