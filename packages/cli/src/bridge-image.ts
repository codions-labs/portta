import { BRIDGE_IMAGE } from 'portta-core'
import type { GatewayContext } from './context.js'
import { PreconditionError } from './errors.js'
import type { Output } from './output.js'
import { type ProcessResult, runProcess } from './process.js'

function dockerCause(result: ProcessResult): string {
  return result.error || result.stderr.trim() || result.stdout.trim() || `Docker exited with code ${result.exitCode}`
}

/** The panel cannot pull images, so its host prepares the fixed access bridge. */
export async function ensurePanelBridgeImage(
  context: Pick<GatewayContext, 'config' | 'env'>,
  output: Pick<Output, 'progress'>,
  options: { allowPull?: boolean } = {},
): Promise<void> {
  if (!context.config.webEnabled) return

  const inspect = () => runProcess('docker', ['image', 'inspect', BRIDGE_IMAGE], { env: context.env, reject: false })
  const present = await inspect()
  if (present.exitCode === 0) return

  const hint = `run on the Docker host: docker pull ${BRIDGE_IMAGE}`
  if (options.allowPull === false) {
    throw new PreconditionError(
      `the panel access bridge image ${BRIDGE_IMAGE} is unavailable and image pulling is disabled: ${dockerCause(present)}`,
      hint,
    )
  }

  output.progress(`pulling ${BRIDGE_IMAGE} for local access`)
  const pulled = await runProcess('docker', ['pull', BRIDGE_IMAGE], {
    env: context.env,
    reject: false,
    stdio: 'stream',
  })
  if (pulled.exitCode !== 0) {
    throw new PreconditionError(
      `could not pull the panel access bridge image ${BRIDGE_IMAGE}: ${dockerCause(pulled)}`,
      hint,
    )
  }

  const verified = await inspect()
  if (verified.exitCode !== 0) {
    throw new PreconditionError(
      `the panel access bridge image ${BRIDGE_IMAGE} is unavailable after pulling: ${dockerCause(verified)}`,
      hint,
    )
  }
}
