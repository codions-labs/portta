import { meetsMinimum } from 'portta-core'
import { detail, PROBE_TIMEOUT_MS, toolFacts, versionText, withDetails } from './common.js'
import type { EnvironmentProbe } from './types.js'

const MIN_DOCKER_MAJOR = 24
const MIN_COMPOSE_MAJOR = 2
const ID = 'runtime.docker'

export const dockerProbe: EnvironmentProbe = {
  id: ID,
  async probe(context) {
    const facts = await toolFacts(context, 'docker', ['version', '--format', '{{.Client.Version}}'])
    if (!facts.installed || !facts.usable) {
      return [
        withDetails(
          facts,
          {
            id: ID,
            title: 'Docker',
            category: 'infrastructure',
            minimum: String(MIN_DOCKER_MAJOR),
            fix: 'install Docker Engine 24+ or OrbStack',
          },
          [
            detail(
              facts.installed ? 'fail' : 'info',
              facts.installed ? 'Docker client could not run' : 'Docker client not installed',
            ),
          ],
        ),
      ]
    }

    const [engine, daemon, compose] = await Promise.all([
      context.run(facts.path!, ['version', '--format', '{{.Server.Version}}'], {
        reject: false,
        timeout: PROBE_TIMEOUT_MS,
      }),
      context.run(facts.path!, ['info'], { reject: false, timeout: PROBE_TIMEOUT_MS }),
      context.run(facts.path!, ['compose', 'version', '--short'], { reject: false, timeout: PROBE_TIMEOUT_MS }),
    ])
    const engineVersion = engine.failed ? null : engine.stdout.trim().split('\n')[0] || null
    const composeVersion = compose.failed ? null : compose.stdout.trim().split('\n')[0] || null
    const permissionDenied = /permission denied|access denied/i.test(`${daemon.stderr}\n${daemon.stdout}`)
    const details = [
      detail('pass', `client: ${versionText(facts.version)} at ${facts.path}`),
      detail(
        engineVersion && meetsMinimum(engineVersion, MIN_DOCKER_MAJOR) ? 'pass' : 'warn',
        engineVersion ? `engine: ${engineVersion}` : 'engine version could not be read',
      ),
      detail(
        daemon.failed ? 'fail' : 'pass',
        daemon.failed
          ? permissionDenied
            ? 'daemon reachable, but this user cannot access it'
            : 'daemon is not reachable'
          : 'daemon is reachable and accessible to this user',
      ),
      detail(
        composeVersion && meetsMinimum(composeVersion, MIN_COMPOSE_MAJOR) ? 'pass' : 'fail',
        composeVersion ? `Compose: ${composeVersion}` : 'Compose v2 plugin is not usable',
      ),
    ]
    return [
      withDetails(
        { ...facts, version: engineVersion ?? facts.version },
        {
          id: ID,
          title: 'Docker',
          category: 'infrastructure',
          minimum: String(MIN_DOCKER_MAJOR),
          fix: daemon.failed
            ? 'start Docker and ensure this user can access its socket'
            : 'install the Docker Compose v2 plugin',
        },
        details,
      ),
    ]
  },
}
