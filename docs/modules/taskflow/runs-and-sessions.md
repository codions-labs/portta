# Runs and sessions

## Direct versus Workflow Runs

| Characteristic | Direct Session | Workflow Run |
| --- | --- | --- |
| Primary use | interactive work with one agent | deterministic multi-agent orchestration |
| Input | text or JSON object | text or JSON object exposed as `args` |
| Execution | one root harness session | workflow root plus agent-call executions |
| Interaction | terminal/chat when supported | observe events and transcripts |
| Resume | provider/harness checkpoint | replay completed journal entries, rerun unfinished suffix |
| Definition | harness/provider selection | immutable workflow snapshot |

Both modes are durable Run records in `taskflow.db` in the daemon's state directory (`~/portta/state/host/taskflow.db` for a default installation) and use Taskflow-managed workspace ownership.

## Lifecycle

1. **queued** — request accepted and persisted with its idempotency key.
2. **provisioning** — workspace ownership is being acquired and prepared.
3. **running** — the root session or workflow engine is active.
4. **waiting input** — an interactive execution is blocked on user input.
5. **terminal state** — completed, failed, interrupted, or cancelled.

Taskflow rejects invalid transitions. A failed workspace provision releases any checkout ownership. Active Runs are reconciled after process changes; missing sessions/workers become interrupted rather than remaining falsely active.

## Direct Sessions

Create one with:

```bash
portta flow run direct --harness codex --input "Implement the requested change"
```

The harness reports capabilities for terminal access, interactive input, interruption, and resume. The API and dashboard expose only supported controls. The execution stores the provider session ID and checkpoint supplied by the adapter.

Claude and Codex can expose native conversation history and mobile chat. Custom agents may support only a terminal and optional command-based resume.

## Provider session continuity

Provider sessions are separate from Taskflow Runs:

- Taskflow persists the relationship between Run/Execution and provider session ID.
- The provider owns its conversation history and authentication.
- Reopening a worktree or resuming a Direct Run asks the harness to continue that session.
- A missing provider checkpoint, unsupported capability, or unavailable workspace makes resume unavailable.

For Claude Code, a CLI session ID identifies the conversation. SDK/CLI continuation requires the same working context and access to the provider's local session storage. `--resume <id>` continues a specific conversation; provider-specific `--continue` behavior targets the most recent compatible session. Forking creates a new lineage and should not be treated as the same Execution.

Taskflow deliberately stores only the identifiers and normalized transcript data it needs; it does not replace provider-native session storage.

## Workflow resume

A workflow journal stores metadata and completed `agent()` results under `state/host/runs/<engine-run-id>/` in the daemon's state directory. Stable call keys allow the engine to replay completed work on resume.

Resume behavior:

- completed matching calls are returned from the journal without spawning agents;
- interrupted, running-at-crash, or failed calls execute again;
- the workflow starts from the top so deterministic control flow can reconstruct the same call graph;
- Taskflow durable Runs use the source snapshot captured at creation; and
- a missing Run workspace prevents resume.

The engine does not reconnect to an agent turn that was in flight when the process died. It abandons that provider session and reruns the call.

## Cancel and interrupt

Cancelling a Direct Run calls the harness interrupt/cancel operation, records the Execution and Run as cancelled, and releases checkout ownership. Cancelling an active Workflow Run cancels the engine handle and its active workers before recording the final projection.

Ctrl-C during `portta flow oneshot` exits the CLI with code 130 but intentionally leaves the daemon-owned worktree process active. Resume it with a follow-up prompt.

## Events and transcripts

Runtime events are normalized into Run and Execution projections. Workflow phase/agent events and Direct Session conversation events feed the same presentation layer.

```bash
portta flow runs show <run-id>
portta flow runs transcript <execution-id>
```

Transcripts may contain:

- user and assistant messages;
- reasoning/status blocks;
- tool calls and results;
- terminal output;
- file-change summaries;
- usage and duration; and
- provider errors.

The dashboard fetches a snapshot first and then consumes stream updates. Sequence/cursor data prevents clients from treating duplicate delivery as new work.

## Worktree sessions outside Runs

Worktree commands are a first-class surface. They share session adapters, metadata, terminal transport, and native chat with Direct Runs, but the worktree itself is the primary lifecycle object. Use durable Direct Runs when Run history, workspace policy, and normalized Execution records are required.

## Recovery boundaries

- A browser refresh is safe; terminal and provider processes continue outside the browser.
- A host daemon restart can rediscover multiplexer windows and saved worktree sessions.
- An in-process Workflow Run becomes interrupted if its engine handle disappears; resume uses its snapshot and journal.
- Terminal scrollback is not a durable transcript. Native conversation history and Taskflow execution transcripts are the durable user-facing records.
- Moving between tmux and herdr recreates layouts and does not migrate arbitrary child processes.
