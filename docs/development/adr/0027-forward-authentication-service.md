# 0027. Protected application hosts use ForwardAuth

**Status:** Accepted

Project hostnames and expiring shares can require credentials. Traefik asks the
isolated `portta-auth` service before forwarding those requests. Credentials
are scrypt hashes in `state/auth/protections.json`; plaintext is shown only when
created. The service mounts that store read-only and has no Docker socket or
database access.

On the `remote-public` profile every routed service passes ForwardAuth, and the
store decides per hostname: a record in mode `protected` asks for the
credential, a record in mode `public` lets everybody in, and a hostname with no
record is closed. A decision is a rewrite of the store and of the generated
Traefik file, so it takes effect at once, with no container recreated
(`portta protect open|host|remove|status`; `portta adopt` stops with a pending
`public_exposure` decision until `--protect` or `--public` settles it).

Login routers use a reserved path and never reference the authentication
middleware. The middleware fails closed when the auth service or store is not
available. Panel sign-in is handled by the panel itself under ADR 0035.
