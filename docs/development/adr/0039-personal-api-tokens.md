# 0039. A token belongs to a person, and never exceeds them

**Status:** Accepted; see [0035](0035-authentication-lives-in-the-panel.md)

## Context

A browser has a session. A CLI on a laptop, an agent in a terminal and a job in
CI do not, and giving them one would mean a headless sign-in — which is a
password in a script.

A token that is an independent grant — a row carrying capabilities of its
own, beside the ForwardAuth protections — is one nobody remembers to review.
That shape was rejected.

## Decision

A Portta token is a `ptt_`-prefixed Bearer credential **belonging to a user**,
issued through Better Auth's api-key plugin into the panel's own database.

**It never exceeds its owner.** What a token holds is the intersection of its
own scopes and its owner's role, computed on every request. Lowering somebody's
role lowers every token they made without touching the tokens; banning them
stops all of them at once; removing them takes the rows with the account.

**Its default is the smallest thing that is useful.** A token declares whether
it is used by a person or by an agent. A person's holds their whole role, as if
they were at the keyboard. An agent's holds what agents hold on this panel —
the `agentPermissions` setting, defaulting to a developer minus the three
things that change how the panel itself behaves. Asking for scopes the owner
does not hold is a 400 that names exactly which ones did not fit.

**The secret is shown once.** The panel stores a hash and the first characters,
enough to recognise a token in a listing and useless to anybody else. The
prefix is deliberate: `ptt_` is a shape a secret scanner can be taught.

**Ownership decides who may act on one.** Your tokens are yours to make and
revoke. Somebody else's needs `user:list` to see and `user:update` to revoke,
because revoking a colleague's credential is an administrative act — and the
one that makes a lost laptop somebody else's problem to solve.

**Bearer, and nothing else.** `x-api-key` is not accepted, whatever the plugin
would do with it: one way in is one way to reason about.

## Consequences

Revoking is immediate on the next request that carries the token, and the row
stays so a listing can still say what was revoked. Housekeeping disables a
token that expired more than thirty days ago and deletes one revoked more than
ninety days ago.

`state/auth/protections.json` carries only what it is for — the ForwardAuth
protections for project hostnames and shares
([ADR 0027](0027-forward-authentication-service.md)), which have nothing to
do with who may administer the panel. Panel tokens live in the panel's
database.

`portta auth login` checks a token against the panel before saving it, so a
typo fails at the terminal rather than on the next command, and the store is
one entry per panel URL: a laptop panel and a server panel are not the same
credential.
