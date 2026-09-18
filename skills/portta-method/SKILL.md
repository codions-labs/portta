---
name: portta-method
description: The working method for repositories managed with Portta — where branches come from, where worktrees live, how far to scope tests, what counts as done, and which decisions belong to a person. Use when starting work in a repository managed with Portta, creating a branch or worktree, deciding how much to test, removing a worktree, or judging whether a task is finished.
license: MIT
compatibility: Requires git. The optional reporting commands require the portta CLI.
metadata:
  author: codions-labs
  version: "1"
---

# The Portta working method

Follow these rules in a repository managed with Portta, whichever agent you
are. They are the same rules a person follows here. The repository's own
instructions take precedence wherever they disagree.

## Never credit a tool

No commit, pull request or issue credits an agent, model, vendor or tool. No
`Co-Authored-By` trailer naming one, no "Generated with" footer, no badge, no
emoji signature. Never use a provider or model name as a commit type or scope.

The work is attributed to the person who asked for it. This is not something to
ask about.

## Branches

Branch off `develop` when it exists, otherwise off the main branch. Name it
`<type>/<short-slug>`:

```
fix/worktree-removal-guard
feat/issue-to-run
docs/local-name-resolution
```

Two to four words describing the change. Do not put an issue number in the
branch name — link the issue from the pull request instead.

Never commit directly to `main`.

**`develop` is the default, not a wall.** A branch and a pull request are how
work normally reaches it, and that is what you do unless you are told
otherwise. When the person explicitly asks you to work directly on `develop` —
a small fix, a project with one person on it, a change not worth the ceremony —
do that. Every other rule still holds: the same commit format, the same test
scope, the same documentation update, the same honest report. Skipping the
branch is not skipping the work.

**You do not make that call.** Default to a branch; the person is the one who
waives it.

## Worktrees

Use a worktree when work has to run in parallel with other work on the same
repository — another agent, or the person:

```
git worktree add --relative-paths .portta/worktrees/<slug> -b <type>/<slug> develop
```

`--relative-paths` is required. Without it, Git stops working when the checkout
is opened inside a container.

**Never remove a worktree that still holds work existing nowhere else.** Check
first:

```
git -C <worktree> status --short
git -C <worktree> log --oneline <base>..HEAD
git -C <worktree> stash list
```

If any of those return something, stop and report it. Do not force the removal
and do not decide on your own that the work is disposable.

## Commits

Conventional Commits, with an optional scope naming the area touched. The
subject states **the observable effect, in the present tense** — what is now
true for someone using the software, not what you did to the code:

```
fix(cli): a fresh clone installs its dependencies before building the CLI
feat(web): the project page lists the worktrees that have an environment
```

Write `a duplicate answers 409 instead of a 500`, not `add duplicate check`.
Stage by path; never `git add -A`. Never bypass a commit hook.

## Tests

Run the smallest test that proves the change — the matching file or test name,
not a whole suite because a step finished. Full regression belongs to
integration and release.

Test business rules, refusals, contracts, authorization and paths that can lose
data. Do not write tests for visual details such as color, spacing, copy or
icons.

Report which tests ran. If something failed or was skipped, say so plainly with
the output. Never describe work as validated when it was not.

## Documentation

Update documentation in the same change as the behaviour it describes. A
decision that is expensive to reverse belongs in an architecture decision
record, not in a paragraph of a guide.

## Pull requests

A pull request is how a change normally reaches `develop`, including a change
with a single commit. Merge with a merge commit; do not squash.

When the person asked for the work to go straight to `develop`, there is no
pull request to open — say what you changed and how you validated it in your
report instead. Promotion to `main` always goes through a pull request.

The body states the problem, what changed, and how it was validated. Use
`Closes #N` only when merging genuinely completes the issue; `Refs #N`
otherwise.

## Finishing

Work is done when all of these hold:

1. the change is complete — nothing silently left out;
2. the affected tests pass, and the report names which ones ran;
3. documentation matching the change is updated;
4. the pull request is merged;
5. the issue is closed with a comment saying **what was delivered, what was
   deliberately left out, and what is still open**.

That last comment matters more than it looks. It is what explains later why the
issue ended where it did.

## Ask before doing

Stop and ask the person rather than deciding alone:

- pushing, publishing, or anything else that leaves the machine;
- removing a worktree, branch, volume or environment that may hold unique work;
- changing the project's own Compose file, Dockerfile or `.env`;
- doing more than you were asked.

## Reporting commands

When the portta CLI is available, these report facts you should not guess:

```
portta projects list --json
portta env list --json
portta urls
portta flow list
```

Portta reports the state of projects, environments and worktrees. It does not
do the work for you.
