// What this machine is, as opposed to what Portta has been told to be.
//
// Everything here is an observation of the host: whether a tool is on PATH,
// how a file is permissioned, which ranges an address falls in. It never changes anything. The
// verdicts drawn from these facts are pure and live in portta-core; keeping the
// probes out here is what lets those verdicts be tested without a host.
//

import { accessSync, constants, globSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from './process.js'

/**
 * Tailscale's CGNAT range. A tailnet address is reported under its own
 * capability; listing it as a LAN address as well would offer one network
 * twice under two names, and would let `auto-domain` claim the internet can
 * reach a host it cannot.
 */
function isTailscaleRange(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 100 && b !== undefined && b >= 64 && b <= 127
}

/** RFC 1918, plus loopback, link-local and the CGNAT range. */
export function isPrivateAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts as [number, number, number, number]
  if (a === 10 || a === 127) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  return isTailscaleRange(address)
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Where an executable is, looking beyond this process's PATH.
 *
 * A developer's toolchain is usually wired into an interactive shell — nvm in
 * .zshrc, agent CLIs symlinked into ~/.local/bin — and a non-interactive
 * process sees none of it. Reporting "not found" for a tool the machine
 * plainly has is worse than saying nothing, so these are the places worth
 * looking before giving that answer. Mirrors `portta_locate`.
 */
export async function locate(tool: string): Promise<string | null> {
  const onPath = await runProcess('which', [tool], { reject: false })
  const direct = onPath.stdout.trim().split('\n')[0]
  if (!onPath.failed && direct) return direct

  const home = homedir()
  for (const candidate of [
    join(home, '.local/bin', tool),
    join(home, '.bun/bin', tool),
    join(home, '.cargo/bin', tool),
    join(home, '.deno/bin', tool),
    join('/usr/local/bin', tool),
    join('/opt/homebrew/bin', tool),
    join(home, '.volta/bin', tool),
  ]) {
    if (executable(candidate)) return candidate
  }

  // nvm and fnm keep one directory per installed version.
  for (const pattern of [
    join(home, '.nvm/versions/node/*/bin', tool),
    join(home, '.local/share/fnm/node-versions/*/installation/bin', tool),
  ]) {
    for (const match of globSync(pattern)) if (executable(match)) return match
  }
  return null
}

/**
 * The permission bits in octal, or null when the file cannot be read.
 *
 * Unpadded, the way `stat -c %a` and `stat -f %Lp` report them, because that
 * is the spelling every message, comparison and document in the tree already
 * uses: `chmod 600`, "mode 600", "would change .env from 644 to 600".
 */
export function fileMode(path: string): string | null {
  try {
    return (statSync(path).mode & 0o7777).toString(8)
  } catch {
    return null
  }
}
