# Dashboard guide

Taskflow's dashboard is part of Portta's panel. Its pages live under each Project, beside Issues and Environments, and every request they make goes through the panel to the host daemon (`portta host serve`), where git, tmux and the agents are. The panel decides who may make each request with the same roles and Project memberships as the rest of Portta; the daemon only trusts the panel's token.

## What it needs

The pages are part of the panel: whenever the panel is on (`PORTTA_WEB=true`), the rail has a Taskflow entry, the Project tabs show, and the addresses below answer. The work behind them needs the daemon running on the host:

```bash
portta up
portta host serve
```

The panel's route to the daemon and its read-only token come with the panel itself (see [Run the host daemon](../../product/guides/host-daemon.md#let-the-panel-reach-it)). **Settings → Environment** reports whether the panel reaches the daemon with its token (`Taskflow host daemon`).

## Access and permissions

Taskflow adds its own resources to Portta's permission vocabulary: `worktree`, `terminal`, `run`, `workflow`, `agent`, `workspace` and `linear`. The `developer` role can read and operate all of them; the `viewer` role can read worktrees, Runs, workflows, agents, workspaces and Linear context but cannot change them or attach a terminal. See [Authentication](../../product/guides/authentication.md) for roles and Project access.

If the daemon is not running, the pages report the proxy's failure rather than an empty list: `502` when nothing answers, `503` when the panel has no `PORTTA_HOST_URL` or cannot read the token.

## Addresses

| Address | Page |
| --- | --- |
| `/taskflow` | the directories the daemon serves, the Portta Project each one belongs to, and **Add directory** |
| `/projects/<slug>/worktrees` | the Project's worktrees; opens the one used last |
| `/projects/<slug>/worktrees/<branch>` | one worktree and its session (the branch is URL-encoded) |
| `/projects/<slug>/runs` and `/projects/<slug>/runs/<id>` | the Run list, and one Run with its live timeline |
| `/projects/<slug>/workflows` and `/projects/<slug>/workflows/<id>` | the workflow catalog, and one workflow |
| `/projects/<slug>/taskflow/settings` | the Project's agents, integrations, readiness, and this browser's preferences |
| `/settings/taskflow` | this browser's preferences, for every Project |

Each address survives a reload, can be bookmarked and follows the browser's back and forward buttons.

## A Project and its Taskflow Project

The daemon knows a Project by a directory on the host and a URL prefix it chose; Portta knows it by its slug. A Taskflow Project belongs to the Portta Project whose own directory (its path under Projects Home) or one of whose repositories' local paths is that directory.

Opening a Project's **Worktrees**, **Runs** or **Workflows** tab finds that match. When there is none, the tab offers **Add this project to Taskflow** for the Project's directory: a repository that already has `.portta/taskflow.yaml` is registered at once, and one without it is scaffolded and analysed first, with the progress shown. A Project with no directory on the host says so; give it a path under Projects Home, or a repository a local path, first. `/taskflow` adds any directory and removes a registration; removing one leaves the repository, its worktrees and the Portta Project as they are.

A directory no Portta Project claims can still be served, but only somebody who sees every Project reaches it — the same rule as an environment nothing adopted.

## Permissions

Every route is authorised by the panel before it reaches the daemon, in the Project's scope. Controls a person may not use are not shown.

| Permission | What it allows |
| --- | --- |
| `worktree:read` | the worktree list, diffs, CI logs, branches, configuration, the notification stream, and the `/taskflow` list |
| `worktree:write` | create, open, close, archive, label, change profile, pull main, sync pull requests, auto-remove on merge, dismiss notifications |
| `worktree:remove` / `worktree:merge` | remove / merge a worktree |
| `terminal:attach` | the terminal socket, sending prompts, uploads, terminal tabs, the native terminal command, environment exec and terminal commands |
| `run:read` / `run:create` / `run:cancel` / `run:permission` | read Runs, events and transcripts / start and resume / cancel / answer a permission request |
| `workflow:read` | the workflow catalog |
| `agent:read` / `agent:write` | list agents and chat history / manage agents and use the agent chat |
| `workspace:read` / `workspace:operate` / `workspace:trust` / `workspace:expose` | environments, diagnostics and logs / start, stop, restart, rebuild, remove and control services / trust a configuration / expose and revoke endpoints |
| `linear:read` / `linear:write` | assigned issues / post conversations, auto-create worktrees |
| `project:create` / `project:delete` | register a directory / remove a registration |

The `developer` role holds every Taskflow permission, and `viewer` the read ones.

## Worktree list

The sidebar of the Worktrees tab lists active worktrees with branch or label, profile and agents, open or closed state, service health, pull-request status and archive state, with search and an archived toggle. A row's menu opens or closes its session, changes its profile, archives it, creates a sub-worktree from it, merges it, removes it, and posts its conversation to Linear. The main branch and each linked repository offer **Pull** and **Open in Cursor**.

## Creating work

**New** (or `Cmd+Shift+K`) opens the creation dialog: an existing or new branch, a base branch, profile, one or more agents, an initial prompt, runtime environment overrides, and Linear context. When the Project has auto-naming, the branch name can be left empty.

The same dialog starts a Run: a **Direct Session** for interactive work with one harness, or a **Workflow** from the catalog. Choose a workspace strategy and give text or structured JSON input.

## Terminal and chat

An open worktree shows its terminal, streamed over a WebSocket the panel bridges to the daemon's multiplexer session; closing the browser does not stop tmux or herdr. Paste or drop images to upload them into the worktree. The header's **…** menu refreshes the pull-request status and copies the shell command that attaches a local terminal to the same session.

Claude and Codex worktrees can use the web chat instead (Settings → **Use web chat UI**): history, streamed assistant and tool activity, follow-up prompts, `AskUserQuestion` answers and interruption. Agent tabs fork a conversation and switch the visible agent pane.

## Runs and transcripts

The Runs tab lists Direct and Workflow Runs with status, mode, times, workspace and result. A Run shows its executions and live event timeline, and an execution its transcript. Cancel, resume and permission answers appear only when the Run allows them and you hold the permission. A Workflow Run shows the definition it started with.

## GitHub, Linear and notifications

Pull-request badges show merge state, checks, reviews and comments when `gh` is installed and authenticated on the host; failed CI logs and review comments can be sent to the agent. The Linear panel lists assigned issues when `LINEAR_API_KEY` is set, and an issue can seed a worktree.

Agent notifications appear as toasts; opening one selects its worktree, and dismissing it tells the daemon so it does not return. The bell in the worktree header keeps the recent ones.

## Environments

A worktree with an environment shows its Runtime card: provider and configuration, trust review, start, stop, restart, rebuild and destroy, and the services with their endpoints. **Services and controls** expands to per-service actions, **Expose** and **Revoke**; **Commands** runs a command inside the environment and copies the commands that open a terminal in it or follow its logs.

## Settings

A Project's Taskflow settings (the gear at the bottom of the sidebar) show the Taskflow Project it is served as, branch auto-naming, custom agents with validation, Linear auto-create, the multiplexer, GitHub auto-remove-on-merge, environment diagnostics, and this browser's preferences: the web chat interface and the SSH host **Open in Cursor** uses. The theme and the language are the panel's own.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd+Up` / `Cmd+Down` | move between worktrees |
| `Cmd+Shift+K` | create a worktree or a Run (`Cmd+K` is the panel's command menu) |
| `Cmd+M` | merge the selected worktree |
| `Cmd+D` | remove the selected worktree |
| `Cmd+Enter` | open the selected worktree's session when it is closed |

On Linux and Windows use `Ctrl` in place of `Cmd`. Agent prompts the dashboard sends on your behalf (fixing CI, reviewing comments) stay in English.
