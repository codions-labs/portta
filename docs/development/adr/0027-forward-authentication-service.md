# 0027. Protected application hosts use ForwardAuth

**Status:** Accepted

Project hostnames and expiring shares can require credentials. Traefik asks the
isolated `portta-auth` service before forwarding those requests. Credentials
are scrypt hashes in `state/auth/protections.json`; plaintext is shown only when
created. The service mounts that store read-only and has no Docker socket or
database access.

Login routers use a reserved path and never reference the authentication
middleware. The middleware fails closed when the auth service or store is not
available. Panel sign-in is handled by the panel itself under ADR 0035.
