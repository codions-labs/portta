// The one image that carries the tools Portta needs and the host is not asked
// to install.
//
// Portta promises a host needs only Docker, Git and a shell. curl, jq, dig,
// openssl, socat, psql and redis-cli live in one small image built from
// docker/images/toolbox/Dockerfile, built on demand and cached locally.
//
// Running the tools in a container is not the same as writing the driver in
// shell: ADR 0029 rejects "it drives openssl" as a reason for a `.sh` file,
// because `runProcess` invokes `docker run` with an argument array and no shell
// just as readily.

import { porttaImages } from 'portta-core'
import { versionForRoot } from './context.js'
import { PreconditionError } from './errors.js'
import { runProcess } from './process.js'

export interface ToolboxOptions {
  /** Bind mounts as `host:container[:mode]`. */
  volumes?: string[]
  env?: Record<string, string>
  /** `none` by default: nothing in here should reach the network unasked. */
  network?: string
  /** Kept open so a secret can be piped rather than put on a command line. */
  input?: string
}

export async function toolboxExists(image: string): Promise<boolean> {
  return !(await runProcess('docker', ['image', 'inspect', image], { reject: false })).failed
}

/** Build the image if it is not present. First use only. */
export async function ensureToolbox(root: string, version: string): Promise<string> {
  const image = porttaImages(version).toolbox
  if (await toolboxExists(image)) return image
  const built = await runProcess(
    'docker',
    ['build', '-q', '--build-arg', `PORTTA_VERSION=${version}`, '-t', image, `${root}/docker/images/toolbox`],
    { reject: false },
  )
  if (built.failed) {
    throw new PreconditionError('could not build the toolbox image', `docker build -t ${image} docker/images/toolbox/`)
  }
  return image
}

/**
 * Run one command in the toolbox. Ephemeral by construction: `--rm`, no
 * privileges, and no network unless the caller names one.
 */
export async function runInToolbox(root: string, args: string[], options: ToolboxOptions = {}) {
  // The same version `portta build` tags with, or a checkout builds a second
  // toolbox under its release number on first use.
  const image = await ensureToolbox(root, versionForRoot(root))
  const flags = ['run', '--rm']
  if (options.input !== undefined) flags.push('-i')
  flags.push('--network', options.network ?? 'none')
  for (const volume of options.volumes ?? []) flags.push('--volume', volume)
  for (const [key, value] of Object.entries(options.env ?? {})) flags.push('--env', `${key}=${value}`)
  flags.push(image, ...args)
  return runProcess('docker', flags, { input: options.input, reject: false })
}
