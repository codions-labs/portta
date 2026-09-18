import { Command, CommanderError } from 'commander'
import {
  accessClose,
  accessGc,
  accessInspect,
  accessList,
  accessOpen,
  serviceList,
  servicePublish,
  serviceUnpublish,
} from './commands/access.js'
import { activityCommand } from './commands/activity.js'
import {
  authBootstrap,
  authLogin,
  authLogout,
  authStatus,
  authTokenCreate,
  authTokenList,
  authTokenRevoke,
  authWhoami,
} from './commands/auth.js'
import { buildCommand } from './commands/build.js'
import {
  clientClose,
  clientExec,
  dbDump,
  dbMigrate,
  dbOpen,
  dbRestore,
  dbShell,
  dbStatus,
  dbUrl,
  redisOpen,
} from './commands/clients.js'
import {
  adoptComposeRuntime,
  hasComposeRuntime,
  initComposeRuntime,
  prepareComposeRuntime,
  runtimeAction,
} from './commands/compose-runtime.js'
import { configGet, configList, configPrepare, configSet } from './commands/config.js'
import { docsCommand } from './commands/docs.js'
import { environmentReport, hostCollect, hostServe, hostStatus, hostWatch } from './commands/host.js'
import { hostService } from './commands/host-service.js'
import {
  issuesClose,
  issuesComment,
  issuesCreate,
  issuesEdit,
  issuesList,
  issuesReopen,
  issuesShow,
  issuesStatus,
} from './commands/issues.js'
import {
  bootstrapCommand,
  devCommand,
  doctorCommand,
  downCommand,
  inspectCommand,
  logsCommand,
  resetCommand,
  restartCommand,
  statusCommand,
  upCommand,
  updateCommand,
  urlsCommand,
  versionCommand,
} from './commands/lifecycle.js'
import { backupCommand, repairCommand, restoreCommand } from './commands/maintenance.js'
import { mcpCommand } from './commands/mcp.js'
import {
  dnsCheck,
  dnsSetup,
  dnsStatus,
  networkStatus,
  publicDisable,
  publicEnable,
  publicStatus,
} from './commands/network.js'
import {
  envLogs,
  overviewCommand,
  projectsActivity,
  projectsContext,
  projectsCreate,
  projectsList,
  projectsResources,
  projectsShow,
} from './commands/products.js'
import {
  analyzeCommand,
  initCommand,
  namespaceCommand,
  projectAction,
  projectList,
  projectShow,
  servicesCommand,
} from './commands/projects.js'
import { protectHost, protectStatus, unprotectHost } from './commands/protect.js'
import {
  remoteAccessClose,
  remoteAccessList,
  remoteAccessOpen,
  remoteBootstrap,
  remoteExec,
  remoteGateway,
} from './commands/remote.js'
import { reposClear, reposScan, reposSpecs, reposStatus } from './commands/repos.js'
import { projectsResolve } from './commands/resolve.js'
import { sessionsEnd, sessionsHeartbeat, sessionsList, sessionsStart } from './commands/sessions.js'
import { setupCommand } from './commands/setup.js'
import { shareGc, shareList, shareRevoke } from './commands/share.js'
import { tlsInit, tlsStatus, tlsTrust, tlsUntrust } from './commands/tls.js'
import { toolboxBuild, toolboxRun } from './commands/toolbox.js'
import { tunnelDisable, tunnelEnable, tunnelLogs, tunnelSetup, tunnelStatus, tunnelTest } from './commands/tunnel.js'
import {
  authResetPassword,
  usersCreate,
  usersGrant,
  usersList,
  usersRemove,
  usersRevoke,
  usersSetPassword,
  usersSetRole,
} from './commands/users.js'
import { webBuild, webDisable, webDown, webLogs, webOpen, webRestart, webStatus, webUp } from './commands/web.js'
import { CliError, EXIT } from './errors.js'
import { CLI_MODULES, moduleEnvironment, registerModuleCommands } from './modules/index.js'
import { Output, schemaFor, setJsonSchema } from './output.js'
import { setProcessReporter } from './process.js'
import { cliVersionLine } from './version.js'

function describe(command: Command, description: string): Command {
  return command.description(description).showHelpAfterError('(run with --help for usage)')
}

function projectOption(command: Command): Command {
  return command.requiredOption('--project <name>', 'Compose project name')
}
function serviceOption(command: Command, fallback?: string): Command {
  return fallback
    ? command.option('--service <name>', 'Compose service name', fallback)
    : command.requiredOption('--service <name>', 'Compose service name')
}

const program = new Command()
program
  .name('portta')
  .description('Shared HTTP/TCP gateway for parallel Docker development')
  .version(cliVersionLine())
  .option('--json', 'print machine-readable data to stdout')
  .option('-y, --yes', 'confirm non-interactively')
  .option('--quiet', 'suppress progress output')
  .option('--verbose', 'print diagnostic detail to stderr')
  .option('--profile <name>', 'local, remote-private or remote-public')
  .configureOutput({ writeErr: (value) => process.stderr.write(value) })
  .exitOverride()
  // The process layer decides on its own whether a child streams and whether a
  // slow one announces itself. This is the one place the resolved global flags
  // exist before any command runs, and the one place every command's JSON
  // schema name is known: its own path in this tree.
  .hook('preAction', (_thisCommand, actionCommand) => {
    setProcessReporter(program.opts())
    setJsonSchema(schemaFor(actionCommand))
  })

describe(program.command('version'), 'Print the installed version').action((_options, command) =>
  versionCommand(command),
)

describe(program.command('setup'), 'Install or update a gateway from the packaged runtime')
  .option('--dir <path>', 'gateway installation directory')
  .option('--dry-run', 'print the idempotent plan without changing anything')
  .option('--skip-pull', 'do not pull images')
  .action(setupCommand)

describe(program.command('bootstrap'), 'Prepare this installation and run diagnostics')
  .option('--skip-pull', 'do not pull component images')
  .action(bootstrapCommand)
describe(program.command('build'), 'Build every local Portta image for this checkout').action((_options, command) =>
  buildCommand(command),
)
describe(program.command('up [profile]'), 'Start gateway components')
  .option('--local-release', 'use the locally built image for this checkout')
  .option('--attach', 'run in the foreground')
  .option('--demo', 'also start portta-demo-* projects from PORTTA_PROJECTS_HOME')
  .action((profile: string | undefined, options, command) =>
    hasComposeRuntime() ? runtimeAction('up', {}, command) : upCommand(profile, options, command),
  )
describe(program.command('dev [profile]'), 'Start a checkout from local Dockerfiles, never the published images')
  .option('--reset', 'stop every Portta-managed stack, drop their volumes, and start as if this checkout were new')
  .option('--demo', 'also start portta-demo-* projects from PORTTA_PROJECTS_HOME')
  .action((profile: string | undefined, options, command) => devCommand(profile, options, command))
describe(program.command('down'), 'Stop the current Compose runtime, or gateway components; keep projects and data')
  .option('--demo', 'also stop portta-demo-* projects from PORTTA_PROJECTS_HOME and drop their volumes')
  .action((options, command) =>
    hasComposeRuntime() ? runtimeAction('down', {}, command) : downCommand(options, command),
  )
describe(
  program.command('reset'),
  'Stop every Portta-managed stack, drop their volumes, and restart this checkout as if it were new',
)
  .option('--demo', 'also recreate portta-demo-* projects from PORTTA_PROJECTS_HOME')
  .action((options, command) => resetCommand(options, command))
describe(program.command('restart'), 'Restart the current Compose runtime, or recreate gateway components').action(
  (_options, command) => (hasComposeRuntime() ? runtimeAction('restart', {}, command) : restartCommand(command)),
)
describe(program.command('status'), 'Show the current Compose runtime, or gateway status').action(
  (_options, command) => (hasComposeRuntime() ? runtimeAction('status', {}, command) : statusCommand(command)),
)
describe(program.command('doctor'), 'Run read-only host and gateway diagnostics').action((_options, command) =>
  doctorCommand(command),
)
describe(program.command('urls'), 'List routed HTTP hostnames').option('--project <name>').action(urlsCommand)
describe(program.command('logs [service]'), 'Follow current Compose runtime or gateway component logs')
  .option('--no-follow')
  .option('--tail <lines>', 'line count', '200')
  .action((service, options, command) =>
    hasComposeRuntime()
      ? runtimeAction('logs', { service, follow: options.follow, tail: options.tail }, command)
      : logsCommand(service, options, command),
  )
describe(program.command('inspect'), 'Print resolved configuration without secrets').action((_options, command) =>
  inspectCommand(command),
)
describe(program.command('update'), 'Pull pinned images and recreate after confirmation').action((_options, command) =>
  updateCommand(command),
)
describe(program.command('services'), 'List services in the current Compose runtime').action((_options, command) =>
  runtimeAction('status', {}, command),
)
const compose = describe(program.command('compose'), 'Inspect the effective Compose model for the current runtime')
describe(compose.command('config [path]'), 'Print the effective model from the persisted Runtime Plan').action(
  (path, _options, command) => runtimeAction('config', { path }, command),
)

const envs = describe(program.command('envs'), 'Inspect and operate Compose environments on this host')
  .alias('env')
  .alias('environment')
describe(envs.command('list'), 'List running Compose environments').action((options, command) =>
  projectList(options, command),
)
describe(envs.command('show <name>'), 'Show one environment, its services and URLs').action((name, _options, command) =>
  projectShow(name, command),
)
describe(envs.command('services'), 'List services across running environments')
  .option('--project <name>')
  .action(servicesCommand)
describe(envs.command('report'), 'Collect host environment readiness into state/environment').action(
  (_options, command) => environmentReport(command),
)
describe(envs.command('analyze <path>'), 'Read-only adoption report')
  .option(
    '--file <path>',
    'the Compose file, relative to <path> or absolute; default: compose.yaml and its variants in <path>',
  )
  .action(analyzeCommand)
describe(envs.command('init <path>'), 'Generate and validate a runtime overlay after confirmation')
  .option('--dry-run')
  .option(
    '--service <name:port>',
    'service to expose; repeatable',
    (value, previous: string[]) => previous.concat(value),
    [],
  )
  .option('--file <path>', 'the Compose file, relative to <path> or absolute')
  .option('--project <slug>', 'logical Portta Project slug to emit as portta.project')
  .option('--output <file>', 'explicit overlay path relative to the project')
  .option('--force')
  .action(initCommand)
describe(program.command('prepare [path]'), 'Create and validate the current directory’s isolated Compose Runtime Plan')
  .option(
    '--service <name:port>',
    'service to expose; repeatable',
    (value, previous: string[]) => previous.concat(value),
    [],
  )
  .option('--project <name>', 'explicit Compose project namespace')
  .option('--dry-run')
  .action(async (path, options, command) => {
    await prepareComposeRuntime(
      { path, service: options.service, project: options.project, dryRun: options.dryRun },
      command,
    )
  })
describe(program.command('init [path]'), 'Store optional Compose Runtime intent outside the source repository')
  .option(
    '--service <name:port>',
    'service to expose; repeatable',
    (value, previous: string[]) => previous.concat(value),
    [],
  )
  .option('--project <name>', 'explicit Compose project namespace')
  .option('--manual', 'operate existing Compose integration without Portta mutations')
  .action(async (path, options, command) => {
    await initComposeRuntime(
      { path, service: options.service, project: options.project, manual: options.manual },
      command,
    )
  })
describe(
  program.command('adopt <path>'),
  'Analyze and prepare an isolated Compose Runtime Plan without changing the project',
)
  .option('--dry-run', 'print the plan and pending decisions without writing state')
  .option(
    '--service <name:port>',
    'HTTP service to expose; repeatable',
    (value, previous: string[]) => previous.concat(value),
    [],
  )
  .option('--project <name>', 'explicit Compose project namespace')
  .option('--manual', 'record manual integration instead of generated runtime mutations')
  .option(
    '--remove-container-name <service>',
    'explicitly remove this fixed container name; repeatable',
    (value, previous: string[]) => previous.concat(value),
    [],
  )
  .option('--allow-shared-networks', 'confirm that fixed or external networks may be shared')
  .option('--allow-shared-volumes', 'confirm that fixed or external volumes may be shared')
  .action(async (path, options, command) => {
    await adoptComposeRuntime(
      {
        path,
        service: options.service,
        project: options.project,
        dryRun: options.dryRun,
        manual: options.manual,
        removeContainerName: options.removeContainerName,
        allowSharedNetworks: options.allowSharedNetworks,
        allowSharedVolumes: options.allowSharedVolumes,
      },
      command,
    )
  })
const runtime = describe(program.command('runtime'), 'Operate the persisted Compose Runtime Plan for a project')
describe(runtime.command('up [path]'), 'Prepare when stale, then start the runtime').action((path, _options, command) =>
  runtimeAction('up', { path }, command),
)
describe(runtime.command('down [path]'), 'Stop the runtime using its persisted plan').action(
  (path, _options, command) => runtimeAction('down', { path }, command),
)
describe(runtime.command('restart [path]'), 'Restart the runtime using its persisted plan').action(
  (path, _options, command) => runtimeAction('restart', { path }, command),
)
describe(runtime.command('status [path]'), 'Show the runtime using its persisted plan').action(
  (path, _options, command) => runtimeAction('status', { path }, command),
)
describe(runtime.command('logs [path]'), 'Follow runtime logs using its persisted plan')
  .option('--service <name>')
  .option('--no-follow')
  .option('--tail <lines>', 'line count', '200')
  .action((path, options, command) =>
    runtimeAction('logs', { path, service: options.service, follow: options.follow, tail: options.tail }, command),
  )
describe(runtime.command('config [path]'), 'Print the effective Compose model from its persisted plan').action(
  (path, _options, command) => runtimeAction('config', { path }, command),
)
describe(envs.command('namespace'), 'Derive a collision-safe COMPOSE_PROJECT_NAME')
  .option('--path <dir>')
  .option('--base <name>')
  .option('--suffix <text>')
  .option('--no-check')
  .action(namespaceCommand)
describe(envs.command('start <name>'), 'Start every container in a project, dependencies first').action(
  (name, _options, command) => projectAction(name, 'start', command),
)
describe(envs.command('stop <name>'), 'Stop every container in a project, dependents first').action(
  (name, _options, command) => projectAction(name, 'stop', command),
)
describe(envs.command('restart <name>'), 'Stop then start a project in dependency order').action(
  (name, _options, command) => projectAction(name, 'restart', command),
)
describe(panelOptions(envs.command('logs <name>')), "An environment's logs, every service interleaved")
  .option('--service <name>')
  .option('--tail <lines>', 'line count', '200')
  .action(envLogs)
describe(envs.command('endpoints <name>'), 'The routed hostnames of one environment').action(
  (name, _options, command) => urlsCommand({ project: name }, command),
)

const projects = describe(
  program.command('projects'),
  'The products being developed: list, context, resources, activity',
)
describe(panelOptions(projects.command('list')), 'List Projects').action(projectsList)
describe(panelOptions(projects.command('show <slug>')), 'One Project with its repositories and environments').action(
  (slug, _options, command) => projectsShow(slug, command),
)
describe(panelOptions(projects.command('create')), 'Create a Project')
  .option('--slug <slug>')
  .option('--name <name>')
  .option('--description <text>')
  .option('--path <dir>', 'first-level directory under Projects Home')
  .action(projectsCreate)
describe(panelOptions(projects.command('context <slug>')), 'The Development Context: what to read before working')
  .option('--issue <ref>', 'include one issue in full: github:owner/repo#n or linear:ENG-42')
  .action(projectsContext)
describe(
  panelOptions(projects.command('resolve')),
  'Which Project a directory belongs to: its root, a subdirectory or a worktree',
)
  .option('--path <abs>', 'the directory to resolve; defaults to the current one')
  .action(projectsResolve)
describe(
  panelOptions(projects.command('resources <slug>')),
  "A Project's resource usage, attributed through its environments",
).action((slug, _options, command) => projectsResources(slug, command))
describe(panelOptions(projects.command('activity <slug>')), 'What happened in a Project')
  .option('--kind <a,b>')
  .option('--limit <n>')
  .action(projectsActivity)
describe(panelOptions(program.command('overview')), 'The Development Dashboard: what is happening on this host').action(
  overviewCommand,
)

const access = describe(program.command('access'), 'Open short-lived loopback bridges')
describe(projectOption(serviceOption(access.command('open'))), 'Open a bridge')
  .option('--port <number>')
  .option('--local-port <number>')
  .option('--ttl <duration>')
  .option('--network <name>')
  .option('--bind <ip>', 'bind address', '127.0.0.1')
  .action(accessOpen)
describe(access.command('list').alias('ls'), 'List bridges').action((_options, command) => accessList(command))
describe(access.command('close [id]'), 'Close only gateway-owned bridges')
  .option('--project <name>')
  .option('--all')
  .action(accessClose)
describe(access.command('inspect <id>'), 'Inspect one bridge').action((id, _options, command) =>
  accessInspect(id, command),
)
describe(access.command('gc'), 'Remove expired and orphaned bridges').action((_options, command) => accessGc(command))

const service = describe(program.command('service'), 'Manage persistent private TCP forwarders')
describe(projectOption(serviceOption(service.command('publish'))), 'Publish a service privately')
  .option('--private')
  .option('--public')
  .option('--port <number>')
  .option('--alias <name>')
  .action(servicePublish)
describe(service.command('list'), 'List private forwarders').action((_options, command) => serviceList(command))
describe(service.command('unpublish [alias]'), 'Remove gateway-owned forwarders')
  .option('--project <name>')
  .action(serviceUnpublish)

const network = describe(program.command('network'), 'Inspect host network exposure')
describe(network.command('status'), 'List published bindings')
  .option('--public-ip', 'make one outbound public-IP lookup')
  .action(networkStatus)
const publicCommand = describe(program.command('public'), 'Control deliberate public HTTP exposure')
describe(publicCommand.command('status'), 'Show current public exposure').action((_options, command) =>
  publicStatus(command),
)
describe(publicCommand.command('enable'), 'Enable public HTTP after confirmation').action((_options, command) =>
  publicEnable(command),
)
describe(publicCommand.command('disable'), 'Disable public HTTP').action((_options, command) => publicDisable(command))
const dns = describe(program.command('dns'), 'Inspect or configure wildcard DNS')
describe(dns.command('check'), 'Resolve a wildcard probe').action((_options, command) => dnsCheck(command))
describe(dns.command('status'), 'Show DNS configuration without secrets').action((_options, command) =>
  dnsStatus(command),
)
describe(dns.command('setup'), 'Plan or apply a Cloudflare wildcard record')
  .option('--target <ip>')
  .option('--dry-run')
  .action(dnsSetup)

const web = describe(program.command('web'), 'Run the optional administration panel').option(
  '--local-release',
  'use the locally built image for this checkout',
)
describe(web.command('up'), 'Enable and start the panel')
  .option('--expose <scope>', 'local, tailscale, vpn, public or domain')
  .option('--port <number>')
  .option('--read-only')
  .option('--writable')
  .action((options, command) => webUp({ ...options, localRelease: command.optsWithGlobals().localRelease }, command))
describe(web.command('dev'), 'Start the panel with hot reload')
  .option('--expose <scope>')
  .option('--port <number>')
  .option('--read-only')
  .option('--writable')
  .action((options, command) => webUp({ ...options, dev: true }, command))
describe(web.command('down'), 'Stop the panel only').action((_options, command) => webDown(command))
describe(web.command('disable'), 'Stop and disable the panel').action((_options, command) => webDisable(command))
describe(web.command('restart'), 'Restart panel containers').action((_options, command) => webRestart(command))
describe(web.command('status'), 'Show panel state and URL').action((_options, command) => webStatus(command))
describe(web.command('open'), 'Print and open the panel URL').action((_options, command) => webOpen(command))
describe(web.command('logs [service]'), 'Follow panel logs').action((service, _options, command) =>
  webLogs(service, command),
)
describe(web.command('build'), 'Build the panel image').action((_options, command) => webBuild(command))

const config = describe(program.command('config'), 'Read and change settings on an installed gateway')
describe(config.command('prepare'), 'Create or reconcile .env without starting services').action((_options, command) =>
  configPrepare(command),
)
describe(config.command('list', { isDefault: true }).alias('ls'), 'List the named settings and their values').action(
  (_options, command) => configList(command),
)
describe(config.command('get <setting>'), 'Print one setting').action((name, _options, command) =>
  configGet(name, command),
)
describe(config.command('set <setting> <value>'), 'Change one setting and apply it')
  .option('--no-apply', 'write the value without recreating anything')
  .action((name, value, options, command) => configSet(name, value, options, command))

const repos = describe(program.command('repos'), 'Collect repository state (git, commits, instructions) on the host')
describe(repos.command('scan'), 'Collect every repository into state/git')
  .option('--environment <name>', 'only the repository this environment runs from')
  .option('--path <dir>', 'only this repository')
  .option('--with-prs')
  .option('--forge-ttl <seconds>')
  .action(reposScan)
describe(repos.command('status'), 'Show collected repositories and their age').action((_options, command) =>
  reposStatus(command),
)
describe(repos.command('specs'), 'List the decision records and specification documents the scan recognised')
  .option('--path <dir>', 'only this repository')
  .action(reposSpecs)
describe(repos.command('clear'), 'Remove collected repository files').action((_options, command) => reposClear(command))
const host = describe(program.command('host'), 'Host collectors and the host daemon')
describe(host.command('collect'), 'Write one metrics snapshot into state/metrics').action((_options, command) =>
  hostCollect(command),
)
describe(host.command('watch'), 'Keep collecting host and Docker metrics')
  .option('--loop', 'run in the foreground (used by the detached collector)')
  .action((_options, command) => hostWatch(command))
describe(host.command('status'), 'Show whether the metrics collector is running').action((_options, command) =>
  hostStatus(command),
)
describe(host.command('serve'), 'Run the host daemon (modules that need the host), in the foreground unless detached')
  .option('--detach', 'start it in the background, logging to state/host/daemon.log')
  .action((_options, command) => hostServe(command))
const hostServiceGroup = describe(host.command('service'), 'Run the host daemon as a user service (systemd or launchd)')
describe(hostServiceGroup.command('install'), 'Install, enable and start the portta-host service')
  .option(
    '--env <KEY=VALUE>',
    'write an environment variable into the unit (repeatable)',
    (value: string, previous: string[] = []) => [...previous, value],
  )
  .option('--no-auto-env', 'do not carry LINEAR_API_KEY from this shell into the unit')
  .action((_options, command) => hostService('install', command))
describe(hostServiceGroup.command('uninstall'), 'Stop, disable and remove the service').action((_options, command) =>
  hostService('uninstall', command),
)
describe(hostServiceGroup.command('restart'), 'Restart the service, e.g. after changing .env').action(
  (_options, command) => hostService('restart', command),
)
describe(hostServiceGroup.command('status'), 'Show the service manager status').action((_options, command) =>
  hostService('status', command),
)
describe(hostServiceGroup.command('logs'), 'Follow the service logs').action((_options, command) =>
  hostService('logs', command),
)
const share = describe(program.command('share'), 'Manage panel-created temporary shares')
describe(share.command('list'), 'List shares').action((_options, command) => shareList(command))
describe(share.command('revoke <id>'), 'Revoke one share without touching its project').action(
  (id, _options, command) => shareRevoke(id, command),
)
describe(share.command('gc'), 'Remove expired shares').action((_options, command) => shareGc(command))

const auth = describe(program.command('auth'), 'Who this terminal is, to a panel')
describe(
  panelOptions(auth.command('status', { isDefault: true }), false),
  'Whether this panel asks who you are, and who it thinks you are',
).action(authStatus)
describe(panelOptions(auth.command('login'), false), 'Save a token for a panel, after checking it')
  .option('--token <token>', 'the token; omitted, it is read from the terminal without echoing')
  .action(authLogin)
describe(panelOptions(auth.command('logout'), false), 'Forget the saved credential for a panel').action(authLogout)
describe(auth.command('whoami'), 'Every panel this host has a credential for').action(authWhoami)
describe(panelOptions(auth.command('bootstrap'), false), 'Create the panel owner, once, from this host')
  .requiredOption('--name <name>')
  .requiredOption('--email <email>')
  .option('--password-stdin')
  .action(authBootstrap)
describe(auth.command('reset-password <email>'), 'Reset a password from the host, when nobody can sign in to do it')
  .option('--password-stdin', 'read the password from stdin instead of generating one')
  .action(authResetPassword)
const authToken = describe(auth.command('token'), 'Personal API tokens for this panel')
describe(panelOptions(authToken.command('list', { isDefault: true })), 'Your tokens, without their secrets')
  .option('--all', "every account's tokens; needs user:list")
  .action(authTokenList)
describe(panelOptions(authToken.command('create'), false), 'Create a token; its secret is shown once')
  .requiredOption('--name <name>')
  .option('--human', "a person's token, holding their whole role")
  .option('--scopes <a,b>', 'permissions this token holds, inside your role')
  .option('--expires-in-days <days>', '1 to 365; omitted, it is valid until revoked')
  .action(authTokenCreate)
describe(panelOptions(authToken.command('revoke <id>')), 'Revoke a token').action(authTokenRevoke)

const protect = describe(program.command('protect'), 'ForwardAuth protection for project hostnames and shares')
describe(protect.command('status [host]', { isDefault: true }), 'List protected hosts without credentials').action(
  (host, _options, command) => protectStatus(host, command),
)
describe(protect.command('host <host>'), 'Create or rotate a hostname credential')
  .option('--user <name>')
  .option('--password-stdin')
  .option('--entrypoint <name>')
  .option('--label <text>')
  .option('--project <name>')
  .option('--service <name>')
  .action(protectHost)
describe(protect.command('remove <host>'), 'Remove a hostname credential without changing project labels').action(
  (host, _options, command) => unprotectHost(host, command),
)

const users = describe(program.command('users'), 'The accounts this panel signs in')
describe(panelOptions(users.command('list', { isDefault: true }).alias('ls')), 'List every account').action(usersList)
describe(panelOptions(users.command('create'), false), 'Create an account; a generated password is shown once')
  .requiredOption('--name <name>')
  .requiredOption('--email <email>')
  .option('--role <role>', 'owner, admin, developer or viewer (default: viewer)')
  .option('--projects <a,b>', 'project ids the account starts with')
  .option('--password-stdin')
  .action(usersCreate)
describe(panelOptions(users.command('set-role <email> <role>'), false), "Change an account's role").action(usersSetRole)
describe(panelOptions(users.command('set-password <email>'), false), "Set an account's password and end its sessions")
  .option('--password-stdin')
  .action(usersSetPassword)
describe(panelOptions(users.command('grant <email> <project>'), false), 'Let an account reach one more Project').action(
  usersGrant,
)
describe(panelOptions(users.command('revoke <email> <project>'), false), 'Stop an account reaching a Project').action(
  usersRevoke,
)
describe(panelOptions(users.command('remove <email>'), false), 'Remove an account').action(usersRemove)

const db = describe(program.command('db'), 'Panel database operations and project database clients')
describe(db.command('status'), 'Show the panel database file and its size').action((_options, command) =>
  dbStatus(command),
)
describe(db.command('migrate'), 'Apply pending panel SQL migrations').action((_options, command) => dbMigrate(command))
describe(db.command('shell'), 'Open an interactive sqlite3 on the panel database').action((_options, command) =>
  dbShell(command),
)
describe(db.command('dump [file]'), 'Write a consistent panel backup, safely while it runs').action(
  (file, _options, command) => dbDump(file, command),
)
describe(db.command('restore <file>'), 'Replace the panel database, with the panel stopped').action(
  (file, _options, command) => dbRestore(file, command),
)
describe(projectOption(db.command('open')), 'Open a project database bridge')
  .option('--service <name>', 'service', 'postgres')
  .option('--port <number>')
  .option('--local-port <number>')
  .action(dbOpen)
describe(projectOption(db.command('close')), 'Close project database bridges').action(clientClose)
describe(projectOption(db.command('url')), 'Print a credential-free bridge URL')
  .option('--service <name>', 'service', 'postgres')
  .action(dbUrl)
describe(projectOption(db.command('psql')), 'Run psql inside the project network')
  .option('--service <name>', 'service', 'postgres')
  .option('--port <number>')
  .option('--user <name>')
  .option('--database <name>')
  .argument('[args...]')
  .action((args, options, command) => clientExec('psql', options, args, command))
describe(projectOption(db.command('mysql')), 'Run mysql inside the project network')
  .option('--service <name>', 'service', 'mysql')
  .option('--port <number>')
  .option('--user <name>')
  .option('--database <name>')
  .argument('[args...]')
  .action((args, options, command) => clientExec('mysql', options, args, command))
const redis = describe(program.command('redis'), 'Reach a project Redis privately')
describe(projectOption(redis.command('open')), 'Open a Redis bridge')
  .option('--service <name>', 'service', 'redis')
  .option('--port <number>')
  .option('--local-port <number>')
  .action(redisOpen)
describe(projectOption(redis.command('close')), 'Close project Redis bridges').action(clientClose)
describe(projectOption(redis.command('cli')), 'Run redis-cli inside the project network')
  .option('--service <name>', 'service', 'redis')
  .option('--port <number>')
  .argument('[args...]')
  .action((args, options, command) => clientExec('redis-cli', options, args, command))

describe(program.command('backup'), 'Archive everything this installation cannot regenerate')
  .option('-o, --output <file>', 'where to write the archive')
  .option('--no-database', 'leave the panel database out')
  .action(backupCommand)
describe(program.command('restore [file]'), 'Put a backup back, keeping what it replaced')
  .option('-f, --force', 'replace configuration under a running gateway')
  .action(restoreCommand)
describe(program.command('repair'), 'Recreate what is missing and fix what is provably wrong')
  .option('--dry-run', 'print the plan without changing anything')
  .action(repairCommand)

/** Every work command talks to the panel API, as the UI and `portta mcp` do. */
function panelOptions(command: Command, includeActor = true): Command {
  const configured = command
    .option('--url <url>', 'the panel API base URL; defaults to the local panel')
    .option('--allow-remote', 'permit a non-loopback panel URL, which is where a credential would be sent')
  return includeActor
    ? configured.option('--actor <name>', 'who is asking; recorded as X-Portta-Actor (PORTTA_ACTOR)')
    : configured
}

// `--project` on every verb, and no repository argument: a Project is what
// decides which repository or Linear team an issue lives in (ADR 0050). A body
// is text, a file, or `-` for stdin, the way `gh` spells it.
const issues = describe(program.command('issues'), "A Project's work, wherever it lives: GitHub Issues or Linear")
function issueBody(command: Command): Command {
  return command.option('--body <text>').option('--body-file <path>', "a file, or '-' for stdin")
}
describe(panelOptions(issues.command('list')), 'List issues')
  .requiredOption('--project <slug>')
  .option('--state <open|closed|all>')
  .option('--assignee <login>')
  .option('--label <name>')
  .option('--milestone <title>')
  .option('--q <text>', 'free text search')
  .action(issuesList)
describe(panelOptions(issues.command('show <ref>')), 'One issue, with its body, comments and environments')
  .requiredOption('--project <slug>')
  .action(issuesShow)
describe(issueBody(panelOptions(issues.command('create <title>'))), 'Open an issue')
  .requiredOption('--project <slug>')
  .option('--label <a,b>')
  .option('--assignee <a,b>')
  .option('--milestone <title>')
  .action(issuesCreate)
describe(issueBody(panelOptions(issues.command('edit <ref>'))), 'Change an issue')
  .requiredOption('--project <slug>')
  .option('--title <text>')
  .option('--add-label <a,b>')
  .option('--remove-label <a,b>')
  .option('--add-assignee <a,b>')
  .option('--remove-assignee <a,b>')
  .option('--milestone <title>')
  .action(issuesEdit)
describe(panelOptions(issues.command('close <ref>')), 'Close an issue')
  .requiredOption('--project <slug>')
  .option('--reason <completed|not-planned>')
  .action(issuesClose)
describe(panelOptions(issues.command('reopen <ref>')), 'Reopen an issue')
  .requiredOption('--project <slug>')
  .action(issuesReopen)
describe(issueBody(panelOptions(issues.command('comment <ref> [text]'))), 'Comment on an issue')
  .requiredOption('--project <slug>')
  .action(issuesComment)
describe(panelOptions(issues.command('status')), 'Whether this host can read and write issues').action(
  (_options, command) => issuesStatus(command),
)

const sessions = describe(program.command('sessions'), 'Say who is working on what, since when')
describe(panelOptions(sessions.command('list')), 'List sessions')
  .option('--project <slug>')
  .option('--active', 'only active sessions')
  .action(sessionsList)
describe(panelOptions(sessions.command('start')), 'Start a session')
  .option('--project <slug>')
  .option('--issue <ref>')
  .option('--repository <id>')
  .option('--environment <name>')
  .option('--summary <text>')
  .option('--head <sha>', 'HEAD before the work started')
  .action(sessionsStart)
describe(panelOptions(sessions.command('end <id>')), 'End a session')
  .option('--summary <text>')
  .option('--abandon', 'mark it abandoned rather than ended')
  .option('--head <sha>', 'HEAD after the work')
  .action(sessionsEnd)
describe(panelOptions(sessions.command('heartbeat <id>')), 'Say a session is still alive').action(
  (id, _options, command) => sessionsHeartbeat(id, command),
)

describe(panelOptions(program.command('activity')), 'What happened, newest first')
  .option('--project <slug>')
  .option('--kind <a,b>', 'comma-separated event kinds')
  .option('--issue <ref>')
  .option('--repository <id>')
  .option('--environment <name>')
  .option('--limit <n>')
  .action(activityCommand)

const docs = describe(
  program.command('docs'),
  'Read the documentation bundled with this CLI or an explicitly selected panel',
)
function docsOptions(command: Command): Command {
  return command
    .option('--url <url>', 'read this panel instead of the local corpus')
    .option('--allow-remote', 'permit a non-loopback panel URL')
}
describe(docsOptions(docs.command('list')), 'List documentation')
  .option('--audience <audience>', 'user, developer or all', 'all')
  .action((_options, command) => docsCommand('list', undefined, command))
describe(docsOptions(docs.command('search <query>')), 'Search documentation')
  .option('--audience <audience>', 'user, developer or all', 'all')
  .option('--limit <number>', 'maximum results (1–50)', '10')
  .action((query, _options, command) => docsCommand('search', query, command))
describe(docsOptions(docs.command('show <slug>')), 'Read a document or heading subtree')
  .option('--anchor <id>', 'heading anchor')
  .action((slug, _options, command) => docsCommand('show', slug, command))

describe(program.command('mcp'), 'Serve the panel verbs to an agent over stdio (MCP)')
  .option('--url <url>', 'the panel API base URL; defaults to the local panel')
  .option('--allow-remote', 'permit a non-loopback panel URL, which is where a credential would be sent')
  .option('--actor <name>', 'recorded on every write as X-Portta-Actor', 'agent')
  .option('--docs-source <source>', 'documentation source: local or panel', 'local')
  .action(mcpCommand)

const remote = describe(program.command('remote'), 'Operate a gateway on another host over SSH')
describe(remote.command('bootstrap <target>'), 'Prepare a host and start the gateway there')
  .option('--profile <name>', 'profile to configure', 'remote-private')
  .option('--dir <path>', 'where to install', 'portta')
  .option('--repo <url>', "repository to clone; defaults to this repo's origin")
  .option('--branch <name>', 'branch to check out', 'main')
  .option('--install-docker', 'offer to install Docker when it is missing')
  .option('--dry-run', 'print what would happen, change nothing')
  .action(remoteBootstrap)
for (const name of ['status', 'doctor', 'urls'] as const) {
  describe(remote.command(`${name} <target>`), `Run \`portta ${name}\` there`).action((target, _options, command) =>
    remoteGateway(name, target, command),
  )
}
describe(remote.command('exec <target> [args...]'), 'Run an arbitrary command there')
  .allowUnknownOption(true)
  .action((target, args, _options, command) => remoteExec(target, args, command))
const remoteAccess = describe(remote.command('access'), "Reach a remote project's private TCP services")
describe(remoteAccess.command('open <target>'), 'Open a remote bridge and a tunnel to it')
  .requiredOption('--project <name>', 'Compose project name')
  .requiredOption('--service <name>', 'Compose service name')
  .option('--port <number>', 'the port inside the service')
  .option('--local-port <number>', 'the port to listen on here')
  .option('--dir <path>', 'the gateway directory on the remote host', 'portta')
  .action(remoteAccessOpen)
describe(remoteAccess.command('list', { isDefault: true }).alias('ls'), 'List open tunnels').action(
  (_options, command) => remoteAccessList(command),
)
describe(remoteAccess.command('close [id]'), 'Close one tunnel, or all of them')
  .option('--all')
  .action(remoteAccessClose)

const tunnel = describe(program.command('tunnel'), 'Publish services over HTTPS with no open port')
describe(tunnel.command('status', { isDefault: true }), "Show the connector's state and the routes it serves").action(
  (_options, command) => tunnelStatus(command),
)
describe(tunnel.command('setup'), 'Write the connector configuration from a tunnel token')
  .requiredOption('--zone <domain>', 'the domain whose wildcard points at the tunnel')
  .option('--token-file <path>', 'read the tunnel token from a file')
  .option('--origin <url>', 'where the connector reaches the proxy')
  .option('--apex', 'serve the zone apex as well as the wildcard')
  // Registered only so it can be refused with a reason: a token on a command
  // line is visible in `ps` to every user on the host.
  .option('--token <value>', 'refused; use --token-file or the prompt')
  .action(tunnelSetup)
describe(tunnel.command('enable'), 'Start the connector').action((_options, command) => tunnelEnable(command))
describe(tunnel.command('disable'), 'Stop the connector, keeping the configuration')
  .option('--forget', 'delete the configuration and credentials too')
  .action(tunnelDisable)
describe(tunnel.command('test'), 'Check that the tunnel is carrying traffic').action((_options, command) =>
  tunnelTest(command),
)
describe(tunnel.command('logs'), "Show the connector's own output")
  .option('-n, --lines <count>', 'line count', '50')
  .action(tunnelLogs)

const tls = describe(program.command('tls'), 'Drive local certificates with openssl')
describe(tls.command('status', { isDefault: true }), 'Show certificate and TLS configuration').action(
  (_options, command) => tlsStatus(command),
)
describe(tls.command('init'), 'Create a local CA and a wildcard certificate for the domain').action(
  (_options, command) => tlsInit(command),
)
describe(tls.command('trust'), 'Print the command to trust the CA on this machine').action((_options, command) =>
  tlsTrust(command),
)
describe(tls.command('untrust'), 'Print the command to remove it again').action((_options, command) =>
  tlsUntrust(command),
)
const toolbox = describe(program.command('toolbox'), 'Run pinned operational tools in Docker')
describe(toolbox.command('build'), 'Build the toolbox image').action((_options, command) => toolboxBuild(command))
describe(toolbox.command('run [args...]'), 'Run a command in an ephemeral toolbox container')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action((args, _options, command) => toolboxRun(args, command))

// Official modules add their groups after every base command.
registerModuleCommands(program, { env: moduleEnvironment() }, CLI_MODULES)

/**
 * `portta status | head -3` is an ordinary thing to type, and it made Node
 * throw an unhandled EPIPE and print a stack trace over the output the reader
 * asked for. A closed downstream pipe is not an error here: it means the
 * reader has what they wanted.
 */
function tolerateClosedOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EPIPE') process.exit(0)
      throw error
    })
  }
}

async function main(): Promise<void> {
  tolerateClosedOutput()
  try {
    if (process.argv.length === 2) {
      program.outputHelp()
      return
    }
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return
      process.exitCode = EXIT.usage
      return
    }
    const output = new Output(program.opts())
    if (error instanceof CliError) {
      output.error(error.message)
      if (error.hint) output.hint(error.hint)
      process.exitCode = error.exitCode
      return
    }
    output.error(error instanceof Error ? error.message : String(error))
    process.exitCode = EXIT.failure
  }
}

await main()
