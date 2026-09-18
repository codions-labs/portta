# Host environment readiness

The panel runs in a container, so its `PATH`, SSH client and Docker access do
not describe the host. Portta collects readiness on the host and lets the panel
read the result. The panel never runs these probes itself.

## What is checked

The report separates **installed** from **usable**. Each tool can carry its
version, resolved path and sub-findings that explain the verdict.

| Category | Checks |
|---|---|
| Infrastructure | Docker client, tested engine version, daemon/socket access, Compose v2, Tailscale connection |
| Development | Node.js, npm, npx, Git and its author identity, GitHub CLI and its login, OpenSSH client and agent, tmux |
| Agents | Claude Code, Codex CLI, Cursor agent, Gemini CLI and Antigravity |

An absent optional tool is **information**, not a warning. An installed GitHub
CLI without a login is a recommendation because the workflow exists but cannot
be used. Docker or a required Node tool that cannot run is a problem. Every
probe has a four-second timeout and invokes an executable with an argument
array; it never builds a shell command, creates a tmux session, prints a token,
or stores raw command output.

## Collection and files

```text
state/environment/report.json   latest readiness report, mode 0600
state/environment/security.json read-only host security observations, mode 0600
```

`portta host collect` writes both resource metrics and readiness. The detached
host watcher refreshes readiness every five minutes while keeping resource
metrics on their five-second cadence. To refresh only readiness, run:

```bash
portta envs report
```

The command is also available through the canonical `portta envs report`
spelling. The write is atomic. The panel mounts `state/environment` read-only.

The same refresh collects host security observations. SSH server policy,
installed firewalls and Fail2ban are graded using the host kind and exposure
profile. A permission error remains “could not be checked”; it is never
rewritten as “not installed”. None of these probes uses `sudo` or a mutating
command.

## API and panel

`GET /api/environment` requires `metrics:read`. A missing, oversized, malformed
or old-version file produces a valid “never collected” response, not a server
error. The server validates every check as untrusted input and recomputes the
summary rather than trusting counts from disk.

Settings → Environment shows counts, collection age, tool paths and the
evidence for each verdict. A report older than 15 minutes is marked stale.
Refreshing remains a host action: the page prints `portta envs report` instead
of widening the panel's command or Docker permissions.

`GET /api/environment/security` returns the companion Host security group.
Each row says why the observation matters and links to the relevant guide.
