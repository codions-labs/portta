import { join } from 'node:path'
import { patchEnvFile, porttaImages } from 'portta-core'
import type { GatewayContext } from './context.js'
import { PreconditionError } from './errors.js'
import { runProcess } from './process.js'

export async function requireLocalRelease(context: GatewayContext): Promise<void> {
  if (context.env.PORTTA_LOCAL_RELEASE !== 'true') return
  const missing: string[] = []
  for (const image of Object.values(porttaImages(context.version))) {
    const result = await runProcess('docker', ['image', 'inspect', image], { reject: false })
    if (result.exitCode !== 0) missing.push(image)
  }
  if (missing.length > 0) {
    throw new PreconditionError(
      `local release ${context.version} is incomplete: missing ${missing.join(', ')}`,
      'run just build',
    )
  }
}

export function selectLocalRelease(context: GatewayContext): void {
  const image = porttaImages(context.version).runtime
  patchEnvFile(join(context.root, '.env'), {
    PORTTA_AUTH_IMAGE: image,
    PORTTA_WEB_IMAGE: image,
    PORTTA_WEB_BUILD: 'false',
    PORTTA_WEB_DEV: 'false',
  })
}
