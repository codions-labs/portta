// Preparing the project runner, from the TypeScript CLI.
//
// The argument list lives in portta-core. Everything here is the
// reconciliation around it. See ADR 0030.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isTrue, porttaImages, RUNNER_CONTAINER, runnerCreateArguments, runnerRefusal, runnerSpec } from 'portta-core'
import type { GatewayContext } from '../context.js'
import { runProcess } from '../process.js'

export type RunnerOutcome =
  | { action: 'kept' | 'created' | 'removed' | 'absent' }
  | { action: 'refused'; reason: string }
  | { action: 'failed'; reason: string }

async function label(name: string): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', RUNNER_CONTAINER, '--format', `{{ index .Config.Labels "${name}" }}`],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

async function state(): Promise<string | null> {
  const result = await runProcess(
    'docker',
    ['container', 'inspect', RUNNER_CONTAINER, '--format', '{{ .State.Status }}'],
    { reject: false },
  )
  return result.exitCode === 0 ? result.stdout.trim() : null
}

export async function removeRunner(): Promise<boolean> {
  if ((await label('portta.managed')) !== 'true') return false
  if ((await state()) === 'running') return false
  const result = await runProcess('docker', ['rm', '-f', RUNNER_CONTAINER], { reject: false })
  return result.exitCode === 0
}

export async function ensureRunner(context: GatewayContext): Promise<RunnerOutcome> {
  const exists = (await label('portta.component')) === 'runner'

  if (!isTrue(context.env.PORTTA_RUNNER ?? 'false')) {
    if (!exists) return { action: 'absent' }
    return (await removeRunner()) ? { action: 'removed' } : { action: 'absent' }
  }

  const refusal = runnerRefusal(context.env)
  if (refusal !== null) {
    if (exists) await removeRunner()
    return { action: 'refused', reason: refusal }
  }

  const spec = runnerSpec(context.root, context.version)
  if (exists) {
    if ((await label('portta.runner.spec')) === spec) return { action: 'kept' }
    if (!(await removeRunner())) return { action: 'failed', reason: 'the running runner could not be replaced' }
  }

  const context_dir = join(context.root, 'docker', 'images', 'apply')
  const image = porttaImages(context.version).apply
  if (!existsSync(join(context_dir, 'Dockerfile'))) {
    return { action: 'failed', reason: `no runner image source at ${context_dir}` }
  }
  const present = await runProcess('docker', ['image', 'inspect', image], { reject: false })
  if (present.exitCode !== 0) {
    const built = await runProcess(
      'docker',
      ['build', '--build-arg', `PORTTA_VERSION=${context.version}`, '-t', image, context_dir],
      { reject: false, stdio: 'stream' },
    )
    if (built.exitCode !== 0) return { action: 'failed', reason: `could not build ${image}` }
  }

  const created = await runProcess('docker', runnerCreateArguments(context.root, spec, context.version), {
    reject: false,
  })
  return created.exitCode === 0
    ? { action: 'created' }
    : { action: 'failed', reason: created.stderr.trim() || 'docker create failed' }
}
