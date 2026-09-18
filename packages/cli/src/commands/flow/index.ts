import { Argument, Command, InvalidArgumentError, Option } from 'commander'
import {
  APP_DEFAULTS,
  APP_NAME,
  ENV_NAMES,
  PROJECT_CONFIG_PATH,
  PROJECT_LOCAL_CONFIG_PATH,
} from 'portta-core/taskflow/config'
import {
  commandInvocation,
  commandPath,
  ENVIRONMENT_ACTIONS,
  type FlowGlobals,
  type FlowRunner,
  setFlowInvocation,
} from './flow-action.ts'
import { SERVER_PORT_ENV } from './server-port.ts'

export type { FlowGlobals, FlowRunner } from './flow-action.ts'

export interface FlowCommandOptions {
  /** The command's name; Portta mounts it as `flow`. */
  name?: string
  /** Runs a parsed invocation. Defaults to the real handlers, loaded on demand
   *  so `--help` and `version` never pay for the runtime. */
  run?: FlowRunner
}

export const WORKFLOW_ENGINE_ACTIONS = [
  ['run', 'Run a workflow file or registered workflow with the standalone engine'],
  ['validate', 'Validate a workflow file or registered workflow'],
  ['save', 'Save a workflow file into the registry'],
  ['doctor', 'Check the standalone workflow engine'],
  ['guide', 'Print the workflow authoring guide'],
] as const

const USAGE_HINT = '(run with --help for usage)'

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10)
  if (Number.isNaN(port)) throw new InvalidArgumentError('requires a numeric value')
  return port
}

function collect(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value]
}

/** Help text that names the command the way it was reached. */
function helpAfter(command: Command, text: (invocation: string) => string): Command {
  return command.addHelpText('after', (context) => `\n${text(commandInvocation(context.command))}`)
}

function runOptions(command: Command): Command {
  return command
    .addOption(new Option('--input <text>', 'Run input text').conflicts('inputJson'))
    .option('--input-json <json>', 'Run input as a JSON object')
    .option('--profile <name>', `Profile from ${PROJECT_CONFIG_PATH}`)
    .addOption(
      new Option('--workspace <strategy>', 'Execution workspace (default: workflow policy or worktree)').choices([
        'worktree',
        'branch',
        'current',
      ]),
    )
    .option('--branch <name>', 'Optional generated branch override')
    .option('--base <branch>', 'Base branch for worktree/new branch')
    .addOption(new Option('--transport <transport>', 'Agent transport (default: native)').choices(['native', 'acp']))
    .addOption(
      new Option('--permission-mode <mode>', 'Agent permission mode').choices(['interactive', 'workspace', 'deny']),
    )
    .option('--mcp-json <json>', 'ACP stdio MCP server array')
}

/**
 * The complete Taskflow command tree.
 *
 * Portta mounts it with `program.addCommand(createFlowCommand({ name: 'flow' }))`.
 * Every usage line and example is derived from where the command sits, never
 * from a fixed name. The host daemon, its service and Portta's own `update` and
 * `version` are Portta's commands, not this tree's.
 */
export function createFlowCommand(options: FlowCommandOptions = {}): Command {
  const run = options.run ?? (async (action) => (await import('./dispatch.ts')).runFlowAction(action))
  const flow = new Command(options.name ?? 'flow')

  // Settings are inherited by subcommands created afterwards, so they come first.
  flow
    .description(`${APP_NAME} — parallel AI development in Git worktrees`)
    .helpOption('-h, --help', 'Show this help message')
    .showHelpAfterError(USAGE_HINT)
    .enablePositionalOptions()
    .option('--port <n>', `Host daemon port (default: ${SERVER_PORT_ENV} or ${APP_DEFAULTS.port})`, parsePort)

  const action =
    (command: Command) =>
    async (...received: unknown[]): Promise<void> => {
      setFlowInvocation(commandInvocation(flow))
      process.exitCode = await run({
        path: commandPath(flow, command),
        args: received.slice(0, -2),
        options: command.opts(),
        globals: flow.opts<FlowGlobals>(),
        command,
        root: flow,
      })
    }

  const leaf = (parent: Command, nameAndArgs: string, description: string): Command => {
    const command = parent.command(nameAndArgs).description(description)
    return command.action(action(command))
  }

  /** A command that only groups others: bare, it shows its help; followed by
   *  anything that is not a subcommand, it is a usage error. */
  const group = (command: Command): Command =>
    command.allowExcessArguments().action((_options: unknown, self: Command) => {
      const [unknown] = self.args
      if (unknown !== undefined) self.error(`error: unknown command '${unknown}'`)
      self.help()
    })

  /** Bare, a group runs one of its subcommands, e.g. `runs` lists Runs. */
  const defaultTo = (command: Command, subcommand: Command): Command =>
    command.allowExcessArguments().action(async (_options: unknown, self: Command) => {
      const [unknown] = self.args
      if (unknown !== undefined) self.error(`error: unknown command '${unknown}'`)
      await action(subcommand)()
    })

  const environment = [
    [SERVER_PORT_ENV, 'Host daemon port (--port takes precedence)'],
    [ENV_NAMES.host, 'Address the host daemon listens on'],
    [ENV_NAMES.hostStateDir, 'Host daemon state directory (default: $PORTTA_HOME/state/host)'],
    [ENV_NAMES.projectAllowlist, 'Canonical project roots (colon-separated; default $HOME)'],
  ]
  const width = Math.max(...environment.map(([name = '']) => name.length))
  helpAfter(
    flow,
    () => `Commands that need the host daemon reach it with its token; start it with
\`portta host serve\` (or \`portta host service install\`).

Environment:\n${environment.map(([name = '', text]) => `  ${name.padEnd(width)}  ${text}`).join('\n')}`,
  )

  // ── Projects ───────────────────────────────────────────────────────────────

  helpAfter(
    leaf(flow, 'init', 'Detect/register a project')
      .addOption(
        new Option('--runtime <runtime>', 'Runtime strategy')
          .choices(['auto', 'devcontainer', 'compose', 'dockerfile', 'host'])
          .default('auto'),
      )
      .option('--devcontainer', 'Shortcut for --runtime=devcontainer')
      .option('--compose', 'Shortcut for --runtime=compose')
      .option('--dockerfile', 'Shortcut for --runtime=dockerfile')
      .option('--host', 'Shortcut for --runtime=host')
      .addOption(
        new Option('--analyze [agent]', 'Analyze the repository with an agent')
          .choices(['auto', 'claude', 'codex'])
          .preset('claude'),
      ),
    () => `Runtime selection:
  auto         Prefer Dev Container, then Compose, then Dockerfile, then host.
  devcontainer Use the repository Dev Container explicitly.
  compose      Use the root Docker Compose file explicitly.
  dockerfile   Build and run the root Dockerfile explicitly.
  host         Run development commands on the host.

Analysis:   --analyze=auto uses the default agent only when runtime detection falls back to host.
            --analyze=claude | --analyze=codex always run that agent.`,
  )

  // ── Worktrees ──────────────────────────────────────────────────────────────

  leaf(flow, 'add [branch]', 'Create a worktree using the dashboard lifecycle')
    .option('--existing', 'Use an existing local or remote branch instead of creating a new one')
    .option('--base <branch>', 'Base branch for a new worktree (defaults to config)')
    .option('--profile <name>', `Worktree profile from ${PROJECT_CONFIG_PATH}`)
    .option('--agent <id>', 'Agent id to launch (repeatable)', collect)
    .option('--prompt <text>', 'Initial agent prompt')
    .option('--env <KEY=VALUE>', 'Runtime env override (repeatable)', collect)
    .option('--interface <mode>', 'Session UI: terminal or web-chat')
    .option('-d, --detach', 'Create worktree without switching to it')
    .option(
      '--from-linear <issue-id>',
      `Bootstrap from a Linear issue, plus any saved ${APP_NAME} session or linked PR`,
    )
    .option('--branch <name>', 'Override the branch when --from-linear resolves to one')

  helpAfter(
    leaf(flow, 'oneshot [branch]', 'Run a worktree start-to-finish, streaming logs to stdout')
      .option('--resume <branch>', 'Resume an existing local worktree instead of creating one')
      .option('--prompt <text>', 'Initial agent prompt (required; follow-up nudge when --resume)')
      .option('--agent <id>', 'Agent id to launch')
      .option('--base <branch>', 'Base branch for a new worktree (defaults to config)')
      .option('--profile <name>', `Worktree profile from ${PROJECT_CONFIG_PATH}`)
      .option('--env <KEY=VALUE>', 'Runtime env override (repeatable)', collect)
      .option('--keep-open', "Don't auto-close the worktree session when the agent finishes")
      .option(
        '--linear <id|team>',
        'Tie this oneshot to Linear: ENG-123 loads the issue and posts back; ENG creates an issue when done',
      )
      .option('--branch <name>', 'Override the branch when --linear resolves to one'),
    (invocation) => `Runs an agent worktree start-to-finish, streaming the conversation to stdout.
Does not change the focused tmux session. The server-side oneshot watcher
closes the worktree session (and posts the conversation back to Linear, if
--linear is set) once the agent finishes — even if this CLI is killed mid-run.
Opening the worktree in the browser and interacting with it disarms the watcher.

Exit codes: 0 if the agent opened a PR / the user took over via the browser;
1 if the agent went idle without opening a PR; 130 on Ctrl-C (worktree keeps
running, resume with \`${invocation} --resume <branch> --prompt <text>\`).`,
  )

  leaf(flow, 'doctor', 'Check project, agent, and integration readiness').option(
    '--json',
    'Print machine-readable JSON',
  )

  leaf(flow, 'list', 'List worktrees and their status')
    .addOption(new Option('--all', 'Include archived worktrees').conflicts('archived'))
    .option('--archived', 'Show only archived worktrees')
    .option('--search <text>', 'Filter worktrees by branch/profile/agent')

  leaf(flow, 'open <branch>', 'Open an existing worktree session').option(
    '--interface <mode>',
    'Session UI: terminal or web-chat',
  )
  leaf(flow, 'close <branch>', 'Close a worktree session without removing it')
  leaf(flow, 'refresh <branch>', 'Refresh a Codex agent terminal from saved chat')
  leaf(flow, 'archive <branch>', 'Hide a worktree from the default list')
  leaf(flow, 'unarchive <branch>', 'Show an archived worktree again')
  leaf(flow, 'label <branch> [label...]', 'Set or clear a workspace label')
    .option('--clear', 'Clear the workspace label')
    .option('--label <text>', 'Label text')
  helpAfter(
    leaf(flow, 'profile <branch> [profile]', 'Switch a worktree to another profile').option(
      '--profile <name>',
      'Profile name (alternative to positional arg)',
    ),
    () => `Switches the worktree to another profile from ${PROJECT_CONFIG_PATH}. An open
worktree is restarted with the new pane layout and commands; a closed
one picks the new profile up on its next open.`,
  )
  helpAfter(
    leaf(flow, 'remove <branch>', 'Remove a worktree').option(
      '--force',
      'Remove even when the worktree holds uncommitted changes or commits that exist nowhere else',
    ),
    () => `Removing a worktree deletes its branch, so work that lives only there
is gone. Without --force the removal is refused and says what it found.`,
  )
  leaf(flow, 'merge <branch>', 'Merge a worktree into the main branch and remove it')
  leaf(flow, 'send <branch> [prompt]', 'Send a prompt to a running worktree agent')
    .option('--prompt <text>', 'Prompt text (alternative to positional arg)')
    .option('--preamble <text>', 'Preamble text sent before the prompt')
  helpAfter(
    leaf(flow, 'tab <branch>', 'List, create, switch, or close agent tabs in a worktree')
      .addArgument(new Argument('[action]', 'Tab action').choices(['list', 'new', 'switch', 'close']).default('list'))
      .argument('[tabId]', 'Tab id for switch and close'),
    (invocation) => `Examples:
  ${invocation} <branch>                 List the agent tabs (★ marks the active one)
  ${invocation} <branch> new             Create a new forked tab
  ${invocation} <branch> switch <tabId>  Switch the visible agent pane to a tab
  ${invocation} <branch> close <tabId>   Delete a forked tab`,
  )
  leaf(flow, 'prune', 'Remove all closed (not open) worktrees in the current project')
  leaf(flow, 'restore', 'Re-open all worktree sessions that were open before')
  helpAfter(
    leaf(flow, 'multiplexer', 'Print or switch the multiplexer backing this project').addArgument(
      new Argument('[kind]', 'Move every open worktree to that multiplexer').choices(['tmux', 'herdr']),
    ),
    () => `Panes cannot be handed between multiplexers, so switching closes each open
worktree on the current one and re-opens it on the new one. Agent conversations
resume; scrollback and running processes (dev servers, watchers) do not.

The choice is written to ${PROJECT_LOCAL_CONFIG_PATH} — it is per-machine, not committed.
Restart the host daemon (\`portta host service restart\`) afterwards.`,
  )

  // ── Integrations and projects ──────────────────────────────────────────────

  const linear = flow.command('linear').description('Post a worktree conversation to a Linear issue/team')
  helpAfter(
    leaf(linear, 'post <branch> <team-key>', 'Post a worktree conversation to a new issue in a Linear team').option(
      '--title <text>',
      'Override the auto-derived title for the new issue',
    ),
    (invocation) => {
      const root = invocation.replace(/ linear post$/, '')
      return `Creates a new Linear issue in <team-key> (e.g. ENG) and posts the worktree's
conversation as a JSON attachment + summary comment.

To post into an existing issue, start the session with \`${root} oneshot --linear
<issue-id>\` or \`${root} add --from-linear <issue-id>\` so the issue is the seed.`
    },
  )
  group(linear)

  const project = helpAfter(
    flow.command('project').description('List, add, or remove projects served by the host daemon'),
    () => `The host daemon serves every project together. \`add\` persists the project so
it is reloaded on the next start. These commands talk to the daemon on --port,
${SERVER_PORT_ENV}, or ${APP_DEFAULTS.port}.`,
  )
  leaf(project, 'ls', 'List projects the host daemon is serving').alias('list')
  leaf(project, 'add [path]', 'Add a project (defaults to the current repo)')
  leaf(project, 'rm <prefix>', 'Remove a project by its prefix').alias('remove')
  group(project)

  // ── Workflows and Runs ─────────────────────────────────────────────────────

  const workflows = flow
    .command('workflows')
    .description('List, run, validate, and manage workflow definitions')
    .enablePositionalOptions()
  const workflowsList = leaf(workflows, 'list', 'List the workflows of the current project')
  for (const [name, description] of WORKFLOW_ENGINE_ACTIONS) {
    // The standalone engine parses its own flags, `--help` included.
    const command = workflows
      .command(name)
      .description(description)
      .argument('[args...]')
      .helpOption(false)
      .allowUnknownOption()
      .passThroughOptions()
    command.action(action(command))
  }
  defaultTo(workflows, workflowsList)

  const runCommand = flow.command('run').description('Start a Direct Session or Workflow Run')
  runOptions(leaf(runCommand, 'workflow <workflow-id>', 'Start a Workflow Run'))
  runOptions(
    leaf(runCommand, 'direct', 'Start a Direct Session')
      .requiredOption('--harness <agent>', 'Agent harness to run')
      .option('--provider <name>', 'Model provider')
      .option('--model <name>', 'Model'),
  )
  group(runCommand)

  const runs = flow.command('runs').description('Create, inspect, cancel, or resume Runs')
  const runsList = leaf(runs, 'list', 'List the Runs of the current project')
  leaf(runs, 'show <run-id>', 'Show a Run')
  leaf(runs, 'cancel <run-id>', 'Cancel a Run')
  leaf(runs, 'resume <run-id>', 'Resume a Run')
  leaf(runs, 'transcript <execution-id>', 'Show the structured transcript of an execution')
  leaf(
    runs,
    'permission <run-id> <request-id> <option-id>',
    'Answer an interactive ACP permission request (<option-id> or deny)',
  )
  defaultTo(runs, runsList)

  helpAfter(
    leaf(flow, 'environment [branch]', 'Inspect and manage a worktree or Run environment')
      .alias('env')
      // Not `choices`: with --run the action moves into the first position.
      .argument('[action]', `Environment action (default: status): ${ENVIRONMENT_ACTIONS.join(', ')}`)
      .argument('[args...]', 'Action arguments')
      .option('--run <run-id>', 'Target the environment of a Run instead of a worktree')
      .option('--wait', 'logs: wait until the logs are available')
      .option('--copy', 'open: copy the endpoint URL instead of opening a browser')
      .allowUnknownOption(),
    (invocation) => `Examples:
  ${invocation} <branch> [status|doctor|trust|services|start|stop|restart|rebuild|destroy|terminal|logs|monitor]
  ${invocation} --run <run-id> [action]
  ${invocation} <branch> exec -- <command> [args...]
  ${invocation} <branch> logs [--wait]
  ${invocation} <branch> service <service> <start|stop|restart>
  ${invocation} <branch> open <service> [--copy]
  ${invocation} <branch> expose <service>
  ${invocation} <branch> revoke <endpoint-id>`,
  )

  // ── Shell integration ──────────────────────────────────────────────────────

  leaf(flow, 'completion', 'Generate shell completion script (bash, zsh)').addArgument(
    new Argument('[shell]', 'Target shell').choices(['bash', 'zsh']),
  )
  const complete = flow.command('__complete <kind>', { hidden: true })
  complete.action(action(complete))

  return group(flow)
}
