import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as p from '@clack/prompts'
import type { RuntimeSelection } from 'portta-core/taskflow'
import { APP_DEFAULTS, APP_NAME, PROJECT_CONFIG_PATH } from 'portta-core/taskflow/config'
import { projectPaths } from 'portta-core/taskflow/paths'
import { createProjectsRegistry } from 'portta-host/taskflow/adapters/projects-registry'
import {
  buildInitAgentCommand,
  buildInitPromptSpec,
  buildStarterTemplate,
  detectInitEnvironment,
  detectInitProjectContext,
  type InitAgent,
  type InitAgentStreamEvent,
  runInitAgentCommand,
} from 'portta-host/taskflow/services/init-authoring'
import { daemonBaseUrl, flowApi } from './daemon.ts'
import { flowInvocation } from './flow-action.ts'
import {
  evaluateInitDependencies,
  type InitDependencyStatus,
  isInitAgentSelectable,
  missingRequiredDependencies,
} from './init-deps.ts'
import { isSupportedNodeVersion, MIN_NODE_MAJOR } from './node-runtime.ts'
import { resolveServerPort } from './server-port.ts'
import { CommandUsageError, detectProjectName, getGitRoot, run } from './shared.ts'

function reportDependency(status: InitDependencyStatus): void {
  if (status.found) {
    console.log(`  ✓ ${status.tool}`)
    if (!status.probeOk) {
      console.log(`    ${status.tool} was found but \`${status.tool} ${status.args.join(' ')}\` failed`)
    }
    return
  }
  if (status.required) {
    console.log(`  ✗ ${status.tool} — not found (required)`)
    return
  }
  console.log(`  ○ ${status.tool} — not found (optional)`)
}

function checkDeps(): InitDependencyStatus[] {
  const statuses = evaluateInitDependencies()
  for (const status of statuses) reportDependency(status)
  return statuses
}

function agentLabel(agent: InitAgent): string {
  return agent === 'claude' ? 'Claude' : 'Codex'
}

function createAgentStreamPrinter(label: string): {
  onEvent: (event: InitAgentStreamEvent) => void
  finish: () => void
  sawAssistantText: () => boolean
} {
  const prefix = `  ${label}: `
  let atLineStart = true
  let assistantActive = false
  let sawAssistantText = false

  const closeAssistantLine = (): void => {
    if (assistantActive && !atLineStart) {
      process.stdout.write('\n')
    }
    assistantActive = false
    atLineStart = true
  }

  const writeAssistantChunk = (text: string): void => {
    if (!text) return

    assistantActive = true
    sawAssistantText = true

    for (const char of text) {
      if (atLineStart) {
        process.stdout.write(prefix)
        atLineStart = false
      }
      process.stdout.write(char)
      if (char === '\n') {
        atLineStart = true
      }
    }
  }

  return {
    onEvent(event: InitAgentStreamEvent): void {
      if (event.kind === 'assistant_delta') {
        writeAssistantChunk(event.text)
        return
      }

      if (event.kind === 'assistant_done') {
        closeAssistantLine()
        return
      }

      closeAssistantLine()
      const tag = event.kind === 'warning' ? 'warning' : 'status'
      console.log(`  ${label} ${tag}: ${event.text}`)
    },
    finish(): void {
      closeAssistantLine()
    },
    sawAssistantText(): boolean {
      return sawAssistantText
    },
  }
}

type InitRuntimeSelection = Exclude<RuntimeSelection, 'docker'>
type InitAnalysisSelection = InitAgent | 'auto' | null

export interface InitOptions {
  analyze: InitAnalysisSelection
  runtime: InitRuntimeSelection
}

function needsInteractiveAnalysisFallback(options: InitOptions, selectedRuntime: InitRuntimeSelection): boolean {
  return options.analyze === null && options.runtime === 'auto' && selectedRuntime === 'host'
}

export function resolveInitAnalysis(options: InitOptions, selectedRuntime: InitRuntimeSelection): InitAgent | null {
  if (options.analyze === 'auto') {
    return options.runtime === 'auto' && selectedRuntime === 'host' ? APP_DEFAULTS.defaultAgent : null
  }
  return options.analyze
}

async function selectFallbackAgent(): Promise<InitAgent | null> {
  const choice = await p.select({
    message: 'No Dev Container, Compose, or Dockerfile was found. Analyze the repository to prepare its host runtime?',
    options: [
      { value: 'claude', label: 'Analyze with Claude' },
      { value: 'codex', label: 'Analyze with Codex' },
      { value: 'manual', label: 'Skip analysis; create the starter config' },
    ],
  })
  if (p.isCancel(choice) || choice === 'manual') return null
  return choice as InitAgent
}

export interface InitCliOptions {
  runtime?: string
  devcontainer?: boolean
  compose?: boolean
  dockerfile?: boolean
  host?: boolean
  analyze?: string
}

export function initOptionsFromCli(cli: InitCliOptions): InitOptions {
  const shortcuts = (['devcontainer', 'compose', 'dockerfile', 'host'] as const).filter((runtime) => cli[runtime])
  const runtime = (cli.runtime ?? 'auto') as InitRuntimeSelection
  const requested = runtime === 'auto' ? shortcuts : [runtime, ...shortcuts]
  if (requested.length > 1) throw new CommandUsageError('Choose only one runtime override')
  const analyze = cli.analyze ?? null
  if (analyze !== null && analyze !== 'auto' && analyze !== 'claude' && analyze !== 'codex') {
    throw new CommandUsageError('--analyze must be auto, claude, or codex')
  }
  return { analyze, runtime: requested[0] ?? 'auto' }
}

async function registerProject(gitRoot: string): Promise<'hub' | 'registry'> {
  const port = resolveServerPort()
  let hubUpdated = false
  try {
    await flowApi(daemonBaseUrl(port)).addProject({ body: { path: gitRoot } })
    hubUpdated = true
  } catch {
    // The durable registry below is the fallback when no host daemon is live.
  }
  createProjectsRegistry().add({ path: gitRoot, name: detectProjectName(gitRoot), addedAt: Date.now() })
  return hubUpdated ? 'hub' : 'registry'
}

function reportDetection(detection: ReturnType<typeof detectInitEnvironment>): void {
  p.log.info('Detected:')
  p.log.message(
    `  ${detection.devcontainerConfigs.length ? '✓' : '○'} Dev Container${detection.devcontainerConfigs.length ? ` (${detection.devcontainerConfigs.join(', ')})` : ''}`,
  )
  p.log.message(
    `  ${detection.composeFiles.length ? '✓' : '○'} Docker Compose${detection.composeFiles.length ? ` (${detection.composeFiles.join(', ')})` : ''}`,
  )
  p.log.message(`  ${detection.dockerfile ? '✓' : '○'} Dockerfile`)
  p.log.message(`  ${detection.packageJson ? '✓' : '○'} package.json`)
  p.log.message(`  ✓ Runtime strategy: ${detection.selectedRuntime}`)
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runInit(options: InitOptions): Promise<void> {
  p.intro(`${flowInvocation()} init`)

  // Step 1 — Git repo
  const gitRoot = getGitRoot()
  if (!gitRoot) {
    p.log.error('Not inside a git repository. Run this from within a project.')
    p.outro('Aborted.')
    process.exitCode = 1
    return
  }
  p.log.success(`Git root: ${gitRoot}`)

  // Step 2 — Dependency checks
  p.log.step('Checking dependencies...')

  const depStatuses = checkDeps()
  const missing = missingRequiredDependencies(depStatuses)

  if (missing.length > 0) {
    const lines = missing.map((status) => `  ${status.tool}: ${status.hint}`).join('\n')
    p.note(lines, `Install these required dependencies, then re-run ${flowInvocation()} init`)
    p.outro('Setup incomplete.')
    process.exitCode = 1
    return
  }

  // Step 2b — Node version check (>= 24 required)
  if (!isSupportedNodeVersion(process.versions.node)) {
    p.log.error(`Node ${process.versions.node} is too old. ${APP_NAME} requires Node >= ${MIN_NODE_MAJOR}.`)
    p.log.info('Install the current Node.js LTS from https://nodejs.org/')
    p.outro('Setup incomplete.')
    process.exitCode = 1
    return
  }

  // Step 3 — gh auth check
  if (depStatuses.find((status) => status.tool === 'gh')?.found) {
    const ghAuth = run('gh', ['auth', 'status'])
    if (!ghAuth.success) {
      p.log.warning('gh is installed but not authenticated. Run: gh auth login')
    } else {
      p.log.success('gh — authenticated')
    }
  }

  // Step 4 — .portta/taskflow.yaml
  p.log.step('Checking config files...')

  const taskflowYaml = projectPaths(gitRoot).config
  const detection = detectInitEnvironment(gitRoot, options.runtime)
  reportDetection(detection)
  const selectedRuntime = detection.selectedRuntime as InitRuntimeSelection
  let selectedAnalyze = resolveInitAnalysis(options, selectedRuntime)
  const configExists = existsSync(taskflowYaml)
  if (configExists) {
    p.log.info(`${PROJECT_CONFIG_PATH} already exists`)
  } else if (needsInteractiveAnalysisFallback(options, selectedRuntime)) {
    selectedAnalyze = await selectFallbackAgent()
  }

  if (configExists && selectedAnalyze === null) {
    p.log.info('Existing configuration was preserved.')
  } else {
    const selectedAgent: InitAgent = selectedAnalyze ?? 'claude'
    const context = detectInitProjectContext(gitRoot, selectedAgent)
    await mkdir(dirname(taskflowYaml), { recursive: true })

    if (selectedAnalyze === null) {
      await writeFile(
        taskflowYaml,
        buildStarterTemplate({
          projectName: context.projectName,
          mainBranch: context.mainBranch,
          defaultAgent: context.defaultAgent,
          packageManager: context.packageManager,
          environmentProvider: detection.selectedRuntime,
        }),
      )
      p.log.success(`${PROJECT_CONFIG_PATH} created from deterministic detection`)
    } else {
      const available = isInitAgentSelectable(
        depStatuses.find((status) => status.tool === selectedAnalyze) ?? { found: false },
      )
      if (!available) {
        p.log.error(`${agentLabel(selectedAnalyze)} CLI was not found`)
        p.outro('Setup incomplete.')
        process.exitCode = 1
        return
      }
      const label = agentLabel(selectedAnalyze)
      const starterTemplate = buildStarterTemplate({
        projectName: context.projectName,
        mainBranch: context.mainBranch,
        defaultAgent: selectedAnalyze,
        packageManager: context.packageManager,
        environmentProvider: detection.selectedRuntime,
      })

      if (!configExists) await writeFile(taskflowYaml, starterTemplate)

      const prompt = buildInitPromptSpec({ ...context, defaultAgent: selectedAnalyze })
      const command = buildInitAgentCommand(selectedAnalyze, prompt)
      const streamPrinter = createAgentStreamPrinter(label)

      p.log.step(`Running ${label} to adapt ${PROJECT_CONFIG_PATH}...`)
      const result = await runInitAgentCommand(command, gitRoot, { onEvent: streamPrinter.onEvent })
      streamPrinter.finish()

      if (!existsSync(taskflowYaml)) {
        p.log.error(`${label} removed ${PROJECT_CONFIG_PATH}`)

        const details = [
          result.summary ? `Summary:\n${result.summary}` : '',
          result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : '',
        ]
          .filter((entry) => entry.length > 0)
          .join('\n\n')

        if (details) {
          p.note(details, `${label} output`)
        }
        p.outro('Setup incomplete.')
        process.exitCode = 1
        return
      }

      const finalYaml = await readFile(taskflowYaml, 'utf8')
      const changedTemplate = configExists || finalYaml !== starterTemplate

      if (result.exitCode === 0 && changedTemplate) {
        p.log.success(`${label} adapted ${PROJECT_CONFIG_PATH}`)
      } else if (result.exitCode === 0) {
        p.log.warning(`${label} left the starter template unchanged`)
        p.log.warning(`${label} did not change the starter template. Review ${PROJECT_CONFIG_PATH} manually.`)
      } else if (changedTemplate) {
        p.log.warning(`${label} updated ${PROJECT_CONFIG_PATH}`)
        p.log.warning(`${label} exited with code ${result.exitCode}. Review the generated file before using it.`)
      } else {
        p.log.warning(`${label} left the starter template in place`)
        p.log.warning(
          `${label} exited with code ${result.exitCode}. The starter template is still there for manual editing.`,
        )
      }

      if (result.summary && !streamPrinter.sawAssistantText()) {
        p.note(result.summary, `${label} summary`)
      }

      const trimmedStderr = result.stderr.trim()
      if (trimmedStderr) {
        p.note(trimmedStderr, `${label} stderr`)
      }
    }
  }

  const registration = await registerProject(gitRoot)
  p.log.success(
    `Project registered${registration === 'hub' ? ' with the running host daemon' : ' for the next host daemon start'}`,
  )

  // Step 5 — Summary
  p.outro("You're all set! Next steps:")
  console.log()
  console.log(`  1. Review ${PROJECT_CONFIG_PATH} and adjust runtime and exposure overrides if needed`)
  console.log('  2. Keep the host daemon running: portta host serve --detach  (or portta host service install)')
  console.log(`  3. Enable tab completion: eval "$(${flowInvocation()} completion zsh)"  (or bash)`)
  console.log()
}
