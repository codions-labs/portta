# 0060. The panel cleans networks, images and volumes, one resource at a time

**Status:** Accepted; see [0008](0008-web-panel-socket-proxy.md)

## Context

[ADR 0008](0008-web-panel-socket-proxy.md) gave the panel a socket proxy of its
own and kept images, volumes and the system endpoints denied, and it said that a
change granting `IMAGES`, `VOLUMES` or a request shape the panel does not build
itself needs an ADR of its own. This is that ADR.

A Docker host that runs projects for a while fills up with what nobody owns any
more: networks of projects that were removed, images of old builds, volumes of
containers that are gone. The panel could remove a container and nothing else,
so cleaning meant a shell on the host and `docker system prune`, which is the
command [the agent guidelines](../../agent-guidelines.md) forbid because it deletes
what belongs to somebody else. The person who owns the host asked for the
cleaning to be in the panel instead: browse containers, networks, volumes and
images with their sizes, remove what they select, and run a maintenance sweep.

## Decision

The panel may **remove** networks, images and volumes, and report the size of
images and volumes. It may not pull, build, create or prune.

**The proxy** enables `IMAGES`, `VOLUMES` and `SYSTEM` on the panel's proxy
only. Traefik's proxy stays read-only. These are category switches: with
`POST` on, the proxy also forwards `POST /images/create` and
`POST /volumes/prune`, which is why the second layer decides.

**The allowlist** gains exactly four rules: `GET /system/df` (the only call that
reports sizes), and `DELETE` on one network, one image or one volume. Every
prune endpoint, image pull, volume or network creation and the build cache
stay denied, and `allowlist.test.ts` asserts both directions. The client never
sends `force` for any of the three, so Docker refusing a resource that is in use
remains in force as the last line of defence.

**A prune is not Docker's prune.** The panel reads the host, works out what
nothing uses, drops what is protected and removes the rest one at a time. That
keeps the allowlist narrow, lets one stubborn resource be reported while the
others go, and makes the preview (`dryRun`) the same computation as the run.

**What is protected.** The server decides on a fresh read of the host, whatever
the request says, and reports a refusal as `skipped` rather than failing:

| | `portta` | `docker` | `in-use` |
|---|---|---|---|
| Network | the four Portta networks, anything labelled `portta.managed`, the Compose project of the stack, anything a Portta container is attached to | `bridge`, `host`, `none`, `ingress`, `docker_gwbridge` | any container references it, running **or stopped** |
| Image | the stack's repositories (the panel image, Traefik, Tailscale, cloudflared, the socket proxy, the bridge image) by repository, so an upgrade does not unprotect them | | a container was created from it |
| Volume | labelled `portta.managed`, in the stack's Compose project, or mounted by a Portta container even when it is stopped | | any container mounts it, running or stopped |

A stopped container counts as using its network and its volumes: removing them
would break it the next time someone starts it.

**Volumes are data.** A volume nothing mounts is often a database whose project
was removed. The maintenance sweep therefore removes only *anonymous* volumes
(the ones Docker named for a container) by default; sweeping named volumes is a
separate, explicit choice and the interface asks for the sweep to be confirmed
by typing a word.

**Permission.** Reading is `docker:read`. Everything that removes is
`docker:destroy`, a permission that existed and nobody used: owner and
administrator hold it, developer, viewer and the default agent do not. Every
removal and every prune is audited with what was asked and what happened
(`docker.resources_removed`, `docker.pruned`), never with a volume's contents.

## Consequences

The panel can now delete data that is not its own, on request, after a
confirmation, and only what no container references. That is a real widening of
what a panel session can do, bounded by role, by the allowlist, by the
server-side protections above and by Docker's own refusal. A deployment that
wants the old boundary sets `IMAGES`, `VOLUMES` and `SYSTEM` back to `"0"` on
the panel proxy: the Host lists then show an error and nothing else breaks.

The build cache is reported nowhere and cleaned nowhere: cleaning it needs the
`BUILD` category, which also allows building, and that is not a trade this ADR
makes. `docker builder prune` on the host remains the way.

Sizes come from `GET /system/df`, which walks every layer and volume and can
take seconds on a large host. The lists read it on demand, never on a timer.

The behaviour is covered by `packages/server/tests/cleanup.test.ts`, which holds
on to the protections (a Portta resource and a stopped container's network
survive every request) rather than to the happy path.
