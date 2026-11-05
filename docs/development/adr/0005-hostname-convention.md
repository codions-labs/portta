# 0005. Hostnames are derived from the labels Compose already injects

**Status:** Accepted

## Context

Every service reachable through the gateway needs a unique hostname. Making
each project spell out a full `Host(...)` rule would mean every worktree has to
edit that rule, which is exactly the manual step that makes parallel
environments annoying enough that people stop creating them.

Docker Compose already labels every container it creates with
`com.docker.compose.project` and `com.docker.compose.service`. Together those
are unique on a host and are precisely the two things a hostname should carry.

## Decision

The convention is:

```
<compose-project>--<service>.<domain>
```

Core's `hostLabel` derives the name and the gateway's `providers.docker.defaultRule`
applies the same normalisation, length bound and digest. A generated overlay may
carry the canonical label in `portta.hostname`, which both consumers honour.
Containers with no Compose labels fall back to the normalised container name.
A project that wants a different
hostname sets an explicit `traefik.http.routers.<name>.rule` label, which wins.

One level of subdomain is used rather than `service.project.domain`, so a
single wildcard certificate (`*.dev.example.com`) covers everything.

## Consequences

A project opts in without naming itself anywhere, and a new worktree gets new
hostnames purely by changing `COMPOSE_PROJECT_NAME`.

The trade-off is that hostnames get long (`base-empresarial-issue59--api`), and
that two project names differing only in punctuation normalise to the same
label. `doctor` reports that collision rather than letting one project quietly
receive the other's traffic.
