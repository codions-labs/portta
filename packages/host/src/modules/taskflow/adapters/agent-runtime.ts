import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { ENV_NAMES, RUNTIME_IDENTITY } from 'portta-core/taskflow/config'
import { isRecord } from '../lib/type-guards.ts'
import { getWorktreeStoragePaths } from './fs.ts'

const GENERATED_AGENT_FILES_EXCLUDES = ['.claude/settings.local.json', '.codex/hooks.json']

interface CommandHookConfig {
  type: 'command'
  command: string
  async?: boolean
  timeout?: number
}

interface HookMatcherConfig {
  matcher?: string
  hooks: CommandHookConfig[]
}

interface HookConfigFile {
  hooks: Record<string, HookMatcherConfig[]>
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function readJsonRecord(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function buildAgentCtlScript(): string {
  return `#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path


CONTROL_ENV_PATH = Path(__file__).resolve().with_name("control.env")
CONTROL_REQUEST_TIMEOUT_SECONDS = 2


def read_control_env():
    env = {}
    try:
        content = CONTROL_ENV_PATH.read_text()
    except OSError as error:
        raise RuntimeError(f"failed to read control.env: {error}") from error

    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if len(value) >= 2 and value.startswith("'") and value.endswith("'"):
            value = value[1:-1].replace("'\\\\''", "'")
        env[key] = value

    return env


def build_parser():
    parser = argparse.ArgumentParser(prog="${RUNTIME_IDENTITY.agentControlBinary}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("agent-stopped")

    status_changed = subparsers.add_parser("status-changed")
    status_changed.add_argument("--lifecycle", choices=["starting", "running", "idle", "stopped"], required=True)
    status_changed.add_argument("--best-effort", action="store_true")

    pr_opened = subparsers.add_parser("pr-opened")
    pr_opened.add_argument("--url")

    runtime_error = subparsers.add_parser("runtime-error")
    runtime_error.add_argument("--message", required=True)

    subparsers.add_parser("claude-user-prompt-submit")
    subparsers.add_parser("claude-post-tool-use")
    subparsers.add_parser("codex-session-start")
    subparsers.add_parser("codex-user-prompt-submit")
    subparsers.add_parser("codex-permission-request")
    subparsers.add_parser("codex-post-tool-use")
    subparsers.add_parser("codex-stop")
    codex_notify = subparsers.add_parser("codex-notify")
    codex_notify.add_argument("notification")

    return parser


def build_payload(command, args, control_env):
    payload = {
        "worktreeId": control_env["${ENV_NAMES.worktreeId}"],
        "branch": control_env["${ENV_NAMES.branch}"],
    }

    if command == "agent-stopped":
        payload["type"] = "agent_stopped"
        return payload
    if command == "status-changed":
        payload["type"] = "agent_status_changed"
        payload["lifecycle"] = args.lifecycle
        return payload
    if command == "pr-opened":
        payload["type"] = "pr_opened"
        if args.url:
            payload["url"] = args.url
        return payload
    if command == "runtime-error":
        payload["type"] = "runtime_error"
        payload["message"] = args.message
        return payload
    raise RuntimeError(f"unsupported command: {command}")


def read_hook_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    return parsed if isinstance(parsed, dict) else {}


def iter_string_values(value):
    if isinstance(value, str):
        yield value
        return
    if isinstance(value, dict):
        for child in value.values():
            yield from iter_string_values(child)
        return
    if isinstance(value, list):
        for child in value:
            yield from iter_string_values(child)


def find_pr_url(value):
    for text in iter_string_values(value):
        match = re.search(r"https://github\\.com/[^\\s\\"]+/pull/\\d+", text)
        if match:
            return match.group(0)
    return None


def is_root_codex_notification(notification):
    thread_id = notification.get("thread-id")
    if not isinstance(thread_id, str) or not re.fullmatch(r"[A-Za-z0-9-]+", thread_id):
        return False

    configured_home = os.environ.get("CODEX_HOME")
    codex_home = Path(configured_home).expanduser() if configured_home else Path.home() / ".codex"
    sessions_dir = codex_home / "sessions"

    try:
        rollout_paths = sessions_dir.glob(f"*/*/*/*{thread_id}.jsonl")
        for rollout_path in rollout_paths:
            try:
                with rollout_path.open(encoding="utf-8") as rollout_file:
                    first_line = rollout_file.readline()
                session_meta = json.loads(first_line)
            except (OSError, json.JSONDecodeError):
                continue

            payload = session_meta.get("payload")
            if not isinstance(payload, dict) or payload.get("id") != thread_id:
                continue

            return payload.get("source") == "cli" and payload.get("thread_source") in (None, "user")
    except OSError:
        return False

    return False


def maybe_send_pr_opened(hook_payload, control_env):
    tool_name = hook_payload.get("tool_name")
    tool_input = hook_payload.get("tool_input")
    if not isinstance(tool_input, dict) or tool_name != "Bash":
        return True

    command = tool_input.get("command")
    if not isinstance(command, str) or "gh pr create" not in command:
        return True

    pr_args = argparse.Namespace(url=find_pr_url(hook_payload.get("tool_response")))
    return send_payload(build_payload("pr-opened", pr_args, control_env), control_env)


def send_payload(payload, control_env):
    request = urllib.request.Request(
        control_env["${ENV_NAMES.controlUrl}"],
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {control_env['${ENV_NAMES.controlToken}']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=CONTROL_REQUEST_TIMEOUT_SECONDS) as response:
            if response.status < 200 or response.status >= 300:
                print(f"control endpoint returned HTTP {response.status}", file=sys.stderr)
                return False
    except urllib.error.HTTPError as error:
        print(f"control endpoint returned HTTP {error.code}", file=sys.stderr)
        return False
    except Exception as error:
        print(f"failed to send runtime event: {error}", file=sys.stderr)
        return False

    return True


def main():
    parsed = build_parser().parse_args()

    try:
        control_env = read_control_env()
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        return 1

    required_keys = [
        "${ENV_NAMES.controlUrl}",
        "${ENV_NAMES.controlToken}",
        "${ENV_NAMES.worktreeId}",
        "${ENV_NAMES.branch}",
    ]
    missing = [key for key in required_keys if not control_env.get(key)]
    if missing:
        print(f"missing control env keys: {', '.join(missing)}", file=sys.stderr)
        return 1

    if parsed.command == "codex-session-start":
        send_payload(build_payload("status-changed", argparse.Namespace(lifecycle="idle"), control_env), control_env)
        return 0

    if parsed.command == "codex-user-prompt-submit":
        send_payload(build_payload("status-changed", argparse.Namespace(lifecycle="running"), control_env), control_env)
        return 0

    if parsed.command == "claude-user-prompt-submit":
        if not send_payload(build_payload("status-changed", argparse.Namespace(lifecycle="running"), control_env), control_env):
            return 1
        return 0

    if parsed.command == "codex-permission-request":
        if os.environ.get("${ENV_NAMES.agentPermissionMode}") != "auto-review":
            send_payload(build_payload("status-changed", argparse.Namespace(lifecycle="idle"), control_env), control_env)
        return 0

    if parsed.command == "codex-post-tool-use":
        hook_payload = read_hook_payload()
        maybe_send_pr_opened(hook_payload, control_env)
        return 0

    if parsed.command == "claude-post-tool-use":
        hook_payload = read_hook_payload()
        return 0 if maybe_send_pr_opened(hook_payload, control_env) else 1

    if parsed.command == "codex-stop":
        send_payload(build_payload("agent-stopped", parsed, control_env), control_env)
        print(json.dumps({}))
        return 0

    if parsed.command == "codex-notify":
        try:
            notification = json.loads(parsed.notification)
        except json.JSONDecodeError:
            return 0
        if (
            isinstance(notification, dict)
            and notification.get("type") == "agent-turn-complete"
            and is_root_codex_notification(notification)
        ):
            send_payload(build_payload("agent-stopped", parsed, control_env), control_env)
        return 0

    payload = build_payload(parsed.command, parsed, control_env)
    if not send_payload(payload, control_env):
        return 0 if getattr(parsed, "best_effort", False) else 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
`
}

export interface AgentRuntimeArtifacts {
  agentCtlPath: string
  claudeSettingsPath: string
  codexHooksPath: string
}

function buildClaudeHookSettings(input: AgentRuntimeArtifacts): HookConfigFile {
  return {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} claude-user-prompt-submit`,
              async: true,
            },
          ],
        },
      ],
      Notification: [
        {
          matcher: 'permission_prompt|elicitation_dialog',
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} status-changed --lifecycle idle`,
              async: true,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} agent-stopped`,
              async: true,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} status-changed --lifecycle running`,
              async: true,
            },
          ],
        },
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} claude-post-tool-use`,
              async: true,
            },
          ],
        },
      ],
    },
  }
}

function buildCodexHookSettings(input: AgentRuntimeArtifacts): HookConfigFile {
  const statusCommand = `${shellQuote(input.agentCtlPath)} status-changed --lifecycle running --best-effort`
  return {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear',
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} codex-session-start`,
              timeout: 30,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} codex-user-prompt-submit`,
              timeout: 30,
            },
          ],
        },
      ],
      PermissionRequest: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} codex-permission-request`,
              timeout: 30,
            },
          ],
        },
      ],
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: statusCommand,
              timeout: 30,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} codex-post-tool-use`,
              timeout: 30,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: 'command',
              command: `${shellQuote(input.agentCtlPath)} codex-stop`,
              timeout: 30,
            },
          ],
        },
      ],
    },
  }
}

async function mergeClaudeSettings(settingsPath: string, hookSettings: HookConfigFile['hooks']): Promise<void> {
  const existing = await readJsonRecord(settingsPath)

  const existingHooks = existing.hooks
  const mergedHooks =
    existingHooks && typeof existingHooks === 'object' && !Array.isArray(existingHooks)
      ? { ...existingHooks, ...hookSettings }
      : hookSettings
  const merged = { ...existing, hooks: mergedHooks }
  await writeFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`)
}

function commandStartsWithAgentCtl(command: string, agentCtlPath: string): boolean {
  const trimmedCommand = command.trimStart()
  const quotedAgentCtlPath = shellQuote(agentCtlPath)
  return (
    trimmedCommand === agentCtlPath ||
    trimmedCommand.startsWith(`${agentCtlPath} `) ||
    trimmedCommand === quotedAgentCtlPath ||
    trimmedCommand.startsWith(`${quotedAgentCtlPath} `)
  )
}

function isTaskflowHookGroup(group: unknown, agentCtlPath: string): boolean {
  if (!isRecord(group) || !Array.isArray(group.hooks)) return false
  return group.hooks.some(
    (hook) =>
      isRecord(hook) && typeof hook.command === 'string' && commandStartsWithAgentCtl(hook.command, agentCtlPath),
  )
}

async function mergeCodexHooksFile(
  hooksPath: string,
  hookSettings: HookConfigFile['hooks'],
  agentCtlPath: string,
): Promise<void> {
  const existing = await readJsonRecord(hooksPath)

  const existingHooks = isRecord(existing.hooks) ? existing.hooks : {}
  const mergedHooks: Record<string, unknown> = { ...existingHooks }
  for (const [eventName, groups] of Object.entries(hookSettings)) {
    const eventGroups = existingHooks[eventName]
    const preservedGroups = Array.isArray(eventGroups)
      ? eventGroups.filter((group) => !isTaskflowHookGroup(group, agentCtlPath))
      : []
    mergedHooks[eventName] = [...preservedGroups, ...groups]
  }

  await writeFile(hooksPath, `${JSON.stringify({ ...existing, hooks: mergedHooks }, null, 2)}\n`)
}

async function resolveGitCommonDir(gitDir: string): Promise<string> {
  try {
    const commonDir = (await readFile(join(gitDir, 'commondir'), 'utf8')).trim()
    if (!commonDir) return gitDir
    return commonDir.startsWith('/') ? commonDir : resolve(gitDir, commonDir)
  } catch {
    return gitDir
  }
}

async function ensureGeneratedAgentFilesIgnored(gitDir: string): Promise<void> {
  const commonDir = await resolveGitCommonDir(gitDir)
  const excludePath = join(commonDir, 'info', 'exclude')
  let existing = ''

  try {
    existing = await readFile(excludePath, 'utf8')
  } catch {
    existing = ''
  }

  const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()))
  const missing = GENERATED_AGENT_FILES_EXCLUDES.filter((entry) => !lines.has(entry))
  if (missing.length === 0) return

  await mkdir(dirname(excludePath), { recursive: true })
  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  await writeFile(excludePath, `${existing}${separator}${missing.join('\n')}\n`)
}

export async function ensureAgentRuntimeArtifacts(input: {
  gitDir: string
  worktreePath: string
}): Promise<AgentRuntimeArtifacts> {
  const storagePaths = getWorktreeStoragePaths(input.gitDir)
  const artifacts: AgentRuntimeArtifacts = {
    agentCtlPath: join(storagePaths.taskflowDir, RUNTIME_IDENTITY.agentControlBinary),
    claudeSettingsPath: join(input.worktreePath, '.claude', 'settings.local.json'),
    codexHooksPath: join(input.worktreePath, '.codex', 'hooks.json'),
  }

  await mkdir(dirname(artifacts.claudeSettingsPath), { recursive: true })
  await mkdir(dirname(artifacts.codexHooksPath), { recursive: true })

  await writeFile(artifacts.agentCtlPath, buildAgentCtlScript())
  await chmod(artifacts.agentCtlPath, 0o755)

  const hookSettings = buildClaudeHookSettings(artifacts)
  const hooks = hookSettings.hooks
  if (!isRecord(hooks)) {
    throw new Error('Invalid Claude hook settings')
  }
  await mergeClaudeSettings(artifacts.claudeSettingsPath, hooks)
  await ensureGeneratedAgentFilesIgnored(input.gitDir)
  await mergeCodexHooksFile(artifacts.codexHooksPath, buildCodexHookSettings(artifacts).hooks, artifacts.agentCtlPath)

  return artifacts
}
