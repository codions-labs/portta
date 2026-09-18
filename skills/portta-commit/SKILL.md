---
name: portta-commit
description: Stage and commit changes in a repository managed with Portta, using Conventional Commits whose subject states the observable effect. Use when committing, writing a commit message, staging changes, or when asked to save work to git. Covers selective staging, message format, hooks, and the rule that no agent, model or tool is ever credited in a commit.
license: MIT
compatibility: Requires git.
metadata:
  author: codions-labs
  version: "1"
---

# Committing

## Never credit a tool

Do not add `Co-Authored-By` trailers naming an agent, model or vendor. Do not
add "Generated with", "Created by", or any tool footer or emoji badge. Do not
use a provider or model name as a commit type or scope.

A commit is attributed to the person who asked for the work. This applies to
every commit, without exception, and you do not need to ask about it.

## Check first

```
git status --short
git diff
git diff --staged
```

Understand what is already staged before adding anything. Staged changes you
did not make belong to the person — do not commit them as part of your change
without saying so.

## Stage selectively

Stage the files that belong to the change, by path:

```
git add path/to/file path/to/other
```

Do not use `git add -A`, `git add .` or `git commit -a`. They sweep in
unrelated work, secrets and scratch files, and you cannot tell afterwards what
was intended.

Never stage: files matching the repository's ignore rules, credentials,
`.env` files, build output, or anything you created only to explore.

## Message format

Conventional Commits. The scope is optional and names the area touched:

```
<type>(<scope>): <subject>
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`,
`style`. Add `!` before the colon for a breaking change.

The subject states **the observable effect, in the present tense** — what is
now true for someone using the software, not what you did to the code:

```
fix(cli): a fresh clone installs its dependencies before building the CLI
feat(web): the project page lists the worktrees that have an environment
docs(guides): local name resolution and custom local domains
fix(server): a duplicate answers 409 instead of a 500
```

| Write | Not |
| --- | --- |
| `a duplicate answers 409 instead of a 500` | `add duplicate check` |
| `hot reloading connects again on port 8081` | `fix websocket bug` |
| `help lists only the commands that exist` | `update help text` |

Someone reading `git log` should learn what changed without opening the diff.

Keep the subject on one line, lowercase, with no trailing period. A body is
optional; use it to explain why, not to restate the diff.

## Follow the repository

If the repository has an established commit convention that differs from this
one, follow the repository. Read recent history before assuming:

```
git log --oneline -20
```

When the repository's convention is unclear and the change is already made,
ask rather than guessing — do not silently impose a different format.

## Issue references

Use `Closes #N` only when this commit genuinely completes that issue. For
partial work use `Refs #N`. Only reference issues that actually exist in the
remote, and never treat a local identifier as a remote issue number.

## Hooks and signing

Respect commit hooks, signing and sign-off configured in the repository. If a
hook rejects the commit, read its output and fix the cause.

Never use `--no-verify`, `--no-gpg-sign` or any other bypass to force a commit
through. A blocking hook is a result to report, not an obstacle to route
around.

## After committing

```
git log -1 --stat
```

Confirm the commit contains what you intended and nothing more. If it swept in
an unrelated file, say so immediately rather than continuing.

Do not push. Pushing leaves the machine and is a separate decision that belongs
to the person, unless they already authorized it for this task.
