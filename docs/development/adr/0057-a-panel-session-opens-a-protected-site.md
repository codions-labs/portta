# 57. A panel session opens a protected site, by a token the panel hands over

* Status: Accepted
* Related: [0027](0027-forward-authentication-service.md), [0035](0035-authentication-lives-in-the-panel.md), [0038](0038-roles-and-project-access.md)

## Context

A protected site asks for its own password, and a person who is signed in to the panel and may see
the project was asked for it all the same. The panel and the site are on different hostnames, so the
panel's session cookie never reaches the site, and the site's login service knows nothing of the
panel's users, roles or memberships (ADR 0027).

## Decision

The site sends the browser to the panel, the panel decides, and the browser comes back with a token.

1. The login page of a protected host offers "Continue with my Portta account", a link to
   `GET /api/site-entry?host=…&next=…&proto=…` on the panel. It is shown only when
   `PORTTA_PANEL_URL` is set for the login service.
2. The panel reads the host from the protection store, so the address it returns to is the store's and
   never the request's. Without a session it returns to the login page saying so. With one, it lets
   the person in when they see everything, or when they are a member of the project that adopted the
   host's environment. A share, and an environment nobody adopted, belong to whoever sees everything
   (ADR 0038). Otherwise it returns saying the account cannot open the project.
3. When the person may, it returns with a token signed with `PORTTA_AUTH_SECRET`, the secret both
   already hold. The token names the host, the decision's scope and epoch and the person, lasts a
   minute and carries its own id. The login service refuses it when the signature, the host, the
   scope or the epoch does not match, and spends its id so it opens one session. It then starts the
   same twelve-hour session a password does, as that person.
4. A browser that got in this way remembers it in a cookie scoped to `/__portta/auth`, and its next
   visit to a login page goes to the panel by itself. One that never did sees the password form
   first.

## Consequences

* A client who was sent a link and cannot reach the panel is never redirected to it; only a browser
  that used the panel before is. Nothing about the panel is on the page unless it is configured.
* Rotating the password or removing the decision ends sessions made this way, because the epoch is
  part of the token and of the session.
* Revoking a person's membership does not end a session they already hold on a site, which lasts
  until it expires, as a password session does.
* The token is in a URL for a minute and is single-use. It is not a credential for the panel.
* A panel running without accounts (`PORTTA_AUTH_MODE=disabled`) has no session to speak for anyone,
  so the link leads back to the password form.
