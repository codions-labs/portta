---
name: portta-pull-request
description: Open and update pull requests for a repository managed with Portta, with a title, body, issue linkage and labels that reflect the actual diff. Use when opening a PR, preparing a PR description, pushing a branch for review, or updating an existing pull request. Covers verified labels, Closes versus Refs, and the rule that no agent, model or tool is ever credited.
license: MIT
compatibility: Requires git and the gh CLI authenticated against the target repository.
metadata:
  author: codions-labs
  version: "1"
---

# Pull requests

## Never credit a tool

Do not add a footer, badge, emoji or trailer crediting an agent, model, vendor
or tool, in the title or the body. Do not name a provider or model as the type
or scope of the title.

The pull request belongs to the person who asked for the work. This is not
something to ask about.

## When there is none to open

A pull request is how a change normally reaches `develop`, including a change
with a single commit. But if the person asked for the work to go straight to
`develop`, there is nothing to open here — that is their call, not yours to
undo. Report what you changed and how you validated it instead.

Promotion to `main` always goes through a pull request.

## Before opening

Confirm there is something to publish and that you are on the right branch:

```
git status --short
git log --oneline <base>..HEAD
git diff <base>...HEAD
```

`<base>` is `develop` when it exists, otherwise the repository's main branch.
Note the three dots in the diff: it compares against the merge base, not the
tip.

Blocking conditions — report instead of working around them:

- an empty diff against the base;
- the head branch equals the base or the default branch;
- a detached HEAD, or an unfinished merge, rebase or cherry-pick;
- uncommitted changes that belong in the pull request.

Check whether a pull request already exists for this branch before creating
another:

```
gh pr list --head <branch> --state open
```

If one exists, update it. Never close and recreate a pull request to fix
something — push a commit or edit the body.

## Pushing

Push normally. **Never force-push** to a shared branch, and never force-push at
all without the person asking for it in this task.

If pushing requires credentials, network access or authorization you were not
given, stop and report — do not try alternatives.

## Title

Conventional Commits, same vocabulary as commits, describing what the change
delivers:

```
fix(taskflow): removing a worktree keeps work that lives only there
feat(web): resolving an issue from the panel
```

Keep it on one line. If the repository titles its pull requests differently,
follow the repository.

## Body

If the repository has a pull request template, use it. Without one, three
sections:

**Problem** — what was wrong or missing, and why it mattered.

**What changed** — the substantive changes, as a short list. Describe behaviour,
not files touched.

**Validation** — what you actually ran and what it returned. Name the tests.
Say plainly when something was skipped, failed, or could not be verified.

Never claim a check passed when you did not run it. An unverified claim in a
pull request body is worse than an admitted gap, because a reviewer trusts it.

Write the body to a UTF-8 file and pass it with `--body-file`; do not inline
multi-line bodies as shell arguments.

```
gh pr create --title <title> --body-file <file> --base <base> --head <branch>
```

## Issue linkage

`Closes #N` only when merging this pull request genuinely completes the issue.
`Refs #N` for partial work, and for a parent issue whose other children are
still open.

Only reference issues that exist in the target repository. Do not infer a link
from a branch name alone.

## Labels and other metadata

Apply only labels that already exist in the repository:

```
gh label list --limit 100
```

Choose labels supported by the actual diff — its nature and the area it
affects. Copying every label from the linked issue is wrong: status, priority
and triage labels describe the issue, not the change.

Do not create labels. Do not infer priority, size, release or blocked status
from a diff. Do not assign people, request reviewers or set a milestone unless
the person named them or a repository rule requires it.

If a label you want does not exist, say so and continue without it.

## Confirm afterwards

A successful command and a printed URL do not prove the metadata was applied:

```
gh pr view <number> --json url,labels,assignees,milestone,reviewRequests
```

Compare what you selected with what is actually there. Report anything that did
not apply, with the reason. If a metadata step fails after the pull request
exists, keep the URL and the body, and fix only what is missing.

## Reporting

Return the confirmed URL, the labels actually applied, and anything left
pending or unverified.
