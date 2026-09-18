// The applier container: the one thing on a host that may drive Compose on the
// panel's behalf.
//
// Traefik reads its static configuration from the environment its container was
// created with (ADR 0003), so a setting the panel saves takes effect only once
// the containers are *recreated*. Recreating them means Compose, and the panel
// deliberately cannot reach it (ADR 0008): its Docker permissions stop at
// start, stop, restart and one fixed container shape.
//
// So `up` prepares a single-purpose container, stopped, whose command is fixed
// at creation time and reads nothing from the panel. Starting it is a
// permission the panel already has. See ADR 0026.
//
// This is the single implementation used by the TypeScript CLI.

import { porttaImages } from './images.ts'

export const APPLY_CONTAINER = 'portta-apply'
export const APPLY_COMPONENT = 'apply'

/**
 * Why the applier is not a Compose service.
 *
 * `up` runs `--remove-orphans`, and Compose decides what is orphaned by the
 * `com.docker.compose.project` label, then by whether the service is still in
 * the project. A Compose applier would therefore remove *itself* mid-run the
 * moment the overlay left the file list — which is precisely what happens when
 * the panel writes PORTTA_APPLY=false and then applies. It also has to survive
 * the `up` it ran, or its exit code and logs are gone and the panel has nothing
 * to report. A plain container carries no project label and is never a
 * candidate.
 */
export function applyCreateArguments(root: string, spec: string, version: string): string[] {
  return [
    'create',
    '--name',
    APPLY_CONTAINER,
    '--label',
    'portta.managed=true',
    '--label',
    `portta.component=${APPLY_COMPONENT}`,
    '--label',
    `portta.apply.spec=${spec}`,
    '--label',
    'traefik.enable=false',
    '--restart',
    'no',
    // The socket is a unix socket, so no network is needed to reach it. Without
    // one the applier cannot resolve a name, reach a registry or be a pivot.
    // The cost is that a newly enabled component whose image is not on the host
    // fails at Compose's pull phase — which runs before convergence, so the
    // failure is clean and the gateway is never left half applied.
    '--network',
    'none',
    // Root, because the socket is root-owned on Linux. Paired with
    // no-new-privileges, and the command it runs only ever mkdir -p paths that
    // bootstrap already created.
    '--user',
    '0:0',
    '--security-opt',
    'no-new-privileges:true',
    '--workdir',
    root,
    '--env',
    `PORTTA_ROOT=${root}`,
    '--env',
    'HOME=/tmp',
    '--volume',
    '/var/run/docker.sock:/var/run/docker.sock',
    // The same absolute path it has on the host, and nothing else. Compose
    // resolves the overlays' relative binds (./config, ./state) against
    // --project-directory and hands the daemon absolute *host* paths; a
    // different path in here would make Docker create empty directories in
    // their place, and Traefik would start with an empty dynamic directory.
    '--volume',
    `${root}:${root}`,
    porttaImages(version).apply,
    // Fixed at creation. The panel sends no argument, ever. No profile either:
    // `up` falls back to PORTTA_PROFILE from the .env the panel just wrote,
    // which is what makes a profile change apply to itself.
    'node',
    `${root}/bin/portta`,
    'up',
  ]
}

/**
 * Recorded on the container so `up` can tell whether root, image and command
 * match the current applier.
 */
export function applySpec(root: string, version: string): string {
  return `${porttaImages(version).apply}|${root}|${version}`
}

/**
 * Why this host must not prepare an applier, or null when it may.
 *
 * Building the panel image is deliberately *not* a refusal. `PORTTA_WEB_BUILD`
 * and `PORTTA_WEB_DEV` add a `build:` stanza whose context is streamed through
 * the Docker socket to the host daemon, with the host's network and layer
 * cache. The applier therefore carries the buildx plugin.
 */
export function applyRefusal(env: Record<string, string | undefined>): string | null {
  // Applying rewrites how the whole host is exposed. Handing that to whoever
  // reaches a public panel is a different decision from handing it to whoever
  // reaches a loopback one, and it is not one this feature makes for you.
  if ((env.PORTTA_WEB_EXPOSE ?? 'local') === 'public') {
    return 'the panel is exposed publicly: apply on the host instead'
  }
  if ((env.PORTTA_PROFILE ?? 'local') === 'remote-public') {
    return 'the remote-public profile applies on the host only'
  }
  return null
}
