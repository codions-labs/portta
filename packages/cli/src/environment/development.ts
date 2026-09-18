import type { DoctorCheck } from 'portta-core'
import { environmentToolVerdict } from 'portta-core'
import { detail, PROBE_TIMEOUT_MS, toolFacts, withDetails } from './common.js'
import type { EnvironmentProbe, ProbeContext } from './types.js'

async function simple(
  context: ProbeContext,
  id: string,
  title: string,
  command: string,
  args: readonly string[],
  optional: boolean,
): Promise<DoctorCheck> {
  const facts = await toolFacts(context, command, args)
  return environmentToolVerdict(facts, {
    id,
    title,
    category: 'development',
    optional,
    fix: optional
      ? `install ${title} if you use that workflow`
      : `install ${title} and expose it on the non-interactive PATH`,
  })
}

export const developmentProbe: EnvironmentProbe = {
  id: 'tools',
  async probe(context) {
    const [node, npm, npx, gitFacts, ghFacts, tailscaleFacts] = await Promise.all([
      simple(context, 'tools.node', 'Node.js', 'node', ['--version'], false),
      simple(context, 'tools.npm', 'npm', 'npm', ['--version'], false),
      simple(context, 'tools.npx', 'npx', 'npx', ['--version'], false),
      toolFacts(context, 'git', ['--version']),
      toolFacts(context, 'gh', ['--version']),
      toolFacts(context, 'tailscale', ['version']),
    ])

    let git = environmentToolVerdict(gitFacts, {
      id: 'tools.git',
      title: 'Git',
      category: 'development',
      optional: true,
      fix: 'install Git if this host owns repositories',
    })
    if (gitFacts.installed && gitFacts.usable) {
      const [name, email] = await Promise.all([
        context.run(gitFacts.path!, ['config', '--global', 'user.name'], { reject: false, timeout: PROBE_TIMEOUT_MS }),
        context.run(gitFacts.path!, ['config', '--global', 'user.email'], { reject: false, timeout: PROBE_TIMEOUT_MS }),
      ])
      const configured = !name.failed && name.stdout.trim() !== '' && !email.failed && email.stdout.trim() !== ''
      git = withDetails(
        gitFacts,
        {
          id: 'tools.git',
          title: 'Git',
          category: 'development',
          optional: true,
          fix: 'configure git config --global user.name and user.email',
        },
        [
          detail('pass', `binary: ${gitFacts.version ?? 'installed'}`),
          detail(
            configured ? 'pass' : 'warn',
            configured ? 'global author identity is configured' : 'global author identity is not configured',
          ),
        ],
      )
    }

    let gh = environmentToolVerdict(ghFacts, {
      id: 'tools.gh',
      title: 'GitHub CLI',
      category: 'development',
      optional: true,
      fix: 'install GitHub CLI if this host works with GitHub',
    })
    if (ghFacts.installed && ghFacts.usable) {
      const auth = await context.run(ghFacts.path!, ['auth', 'status'], { reject: false, timeout: PROBE_TIMEOUT_MS })
      gh = withDetails(
        ghFacts,
        {
          id: 'tools.gh',
          title: 'GitHub CLI',
          category: 'development',
          optional: true,
          fix: 'gh auth login',
        },
        [
          detail('pass', `binary: ${ghFacts.version ?? 'installed'}`),
          detail(auth.failed ? 'warn' : 'pass', auth.failed ? 'installed but not authenticated' : 'authenticated'),
        ],
      )
    }

    let tailscale = environmentToolVerdict(tailscaleFacts, {
      id: 'tools.tailscale',
      title: 'Tailscale',
      category: 'infrastructure',
      optional: true,
      fix: 'install Tailscale only when this host uses a tailnet',
    })
    if (tailscaleFacts.installed && tailscaleFacts.usable) {
      const address = await context.run(tailscaleFacts.path!, ['ip', '-4'], {
        reject: false,
        timeout: PROBE_TIMEOUT_MS,
      })
      tailscale = withDetails(
        tailscaleFacts,
        {
          id: 'tools.tailscale',
          title: 'Tailscale',
          category: 'infrastructure',
          optional: true,
          fix: 'tailscale up',
        },
        [
          detail('pass', `binary: ${tailscaleFacts.version ?? 'installed'}`),
          detail(
            address.failed || address.stdout.trim() === '' ? 'warn' : 'pass',
            address.failed || address.stdout.trim() === '' ? 'installed but not connected' : 'connected to a tailnet',
          ),
        ],
      )
    }

    return [node, npm, npx, git, gh, tailscale]
  },
}
