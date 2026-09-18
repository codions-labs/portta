import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { environmentToolVerdict } from 'portta-core'
import { detail, PROBE_TIMEOUT_MS, toolFacts, withDetails } from './common.js'
import type { EnvironmentProbe } from './types.js'

const SSH_ID = 'tools.ssh'
const TMUX_ID = 'tools.tmux'

export const sshProbe: EnvironmentProbe = {
  id: SSH_ID,
  async probe(context) {
    const facts = await toolFacts(context, 'ssh', ['-V'])
    if (!facts.installed || !facts.usable) {
      return [
        environmentToolVerdict(facts, {
          id: SSH_ID,
          title: 'SSH client',
          category: 'development',
          optional: true,
          fix: 'install an OpenSSH client for remote and repository workflows',
        }),
      ]
    }
    const directory = join(context.homeDir, '.ssh')
    const mode = context.fileMode(directory)
    const agent = context.environment.SSH_AUTH_SOCK
      ? await context.run('ssh-add', ['-l'], { reject: false, timeout: PROBE_TIMEOUT_MS })
      : null
    const details = [
      detail('pass', `client: ${facts.version ?? 'installed'} at ${facts.path}`),
      detail(
        !existsSync(directory) ? 'info' : mode === '700' ? 'pass' : 'warn',
        !existsSync(directory) ? '~/.ssh has not been created' : `~/.ssh mode: ${mode ?? 'could not determine'}`,
      ),
      detail(
        agent && !agent.failed ? 'pass' : 'info',
        agent && !agent.failed ? 'SSH agent is reachable' : 'no usable SSH agent in this shell',
      ),
    ]
    return [
      withDetails(
        facts,
        {
          id: SSH_ID,
          title: 'SSH client',
          category: 'development',
          optional: true,
          fix: mode && mode !== '700' ? 'chmod 700 ~/.ssh' : 'start an SSH agent only when your workflow needs one',
        },
        details,
      ),
    ]
  },
}

export const tmuxProbe: EnvironmentProbe = {
  id: TMUX_ID,
  async probe(context) {
    const facts = await toolFacts(context, 'tmux', ['-V'])
    if (!facts.installed || !facts.usable) {
      return [
        environmentToolVerdict(facts, {
          id: TMUX_ID,
          title: 'tmux',
          category: 'development',
          optional: true,
          fix: 'install tmux only for persistent terminal workflows',
        }),
      ]
    }
    const sessions = await context.run(facts.path!, ['ls'], { reject: false, timeout: PROBE_TIMEOUT_MS })
    return [
      withDetails(
        facts,
        {
          id: TMUX_ID,
          title: 'tmux',
          category: 'development',
          optional: true,
        },
        [
          detail('pass', `binary: ${facts.version ?? 'installed'}`),
          detail(
            sessions.failed ? 'info' : 'pass',
            sessions.failed ? 'no tmux server or sessions are running' : 'tmux server is reachable',
          ),
        ],
      ),
    ]
  },
}
