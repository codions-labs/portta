---
name: portta-resolve-issue
description: Take an issue from assignment to a merged pull request in a repository managed with Portta, working in an isolated worktree. Use when asked to resolve, implement, fix or pick up an issue, to work on a ticket end to end, or to continue work already started on one. Covers understanding before editing, worktree isolation, validation, and reporting what was not done.
license: MIT
compatibility: Requires git. Issue and pull request steps require the gh CLI authenticated against the repository.
metadata:
  author: codions-labs
  version: "1"
---

# Resolving an issue

The order matters. Most failures here come from starting to edit before
understanding, or from reporting success without checking.

## 1. Read the issue and the code

Read the issue in full, including its comments — a decision that changed the
scope is often there rather than in the body.

Then read the actual code it concerns. Confirm the problem exists as described.
An issue can be stale, already fixed, or wrong about the cause.

If what you find contradicts the issue, say so before implementing. Do not
quietly solve a different problem than the one filed.

If the issue is too vague to act on, state the specific ambiguity and what you
would assume. Ask only when proceeding under either reading would waste the
work.

## 2. Take an isolated worktree

Work on an issue goes on its own branch, in its own worktree, so it never
collides with other work in the same repository:

```
git worktree add --relative-paths .portta/worktrees/<slug> -b <type>/<slug> <base>
```

`<base>` is `develop` when it exists, otherwise the main branch. `<type>` is
the same vocabulary commits use — `fix`, `feat`, `refactor`, `docs`. The slug
is two to four words describing the change.

`--relative-paths` is required; without it Git stops working when the checkout
is opened inside a container.

Never work directly on `main`.

A worktree or a branch is the default for issue work. When the person
explicitly asks you to work on `develop` or on the current branch, do that and
say so — every other step below is unchanged.

## 3. Plan before editing

State what you are going to change and where, briefly, before changing it. For
anything beyond a small fix, this is what catches a wrong approach while it is
still cheap.

Scope the work to the issue. A real problem you notice nearby is worth
reporting, not fixing silently in the same change.

## 4. Implement

Follow the conventions already in the files you are editing — naming, comment
density, error handling, test style. Code that reads as if it was always there
is the goal.

Do not reformat, rename or restructure code the issue did not ask about. It
buries the real change in noise.

## 5. Validate

Run the smallest tests that prove the change: the matching file or test name,
not a whole suite because a step finished. Add tests for behaviour that
matters — business rules, refusals, contracts, authorization, paths that can
lose data — not for visual details.

Run the type checker or linter for the affected area when the project has one.

**Report what actually ran and what it returned.** If a test failed, say so with
the output. If you skipped something, say which and why. Never describe work as
validated when it was not — a false "tests pass" costs more than an honest gap.

## 6. Commit and open the pull request

Commit with the repository's convention, staging by path rather than sweeping
everything. Open a pull request against the base, with the problem, the
changes, and the validation you actually performed. Link the issue: `Closes`
only if this genuinely completes it, `Refs` otherwise.

**Do not credit an agent, model, vendor or tool** anywhere in the commits, the
pull request or the issue. The work is attributed to the person who asked
for it.

Do not merge your own pull request unless the person asked for that.

## 7. Report honestly

End with what was delivered, what was **deliberately left out**, and what
remains open or uncertain.

If part of the issue turned out to be blocked or a bad idea, finish everything
else and say plainly what you left and why. Scaling the work down is the
person's decision, not yours.

## Cleaning up

Remove a worktree only after its work is merged or abandoned, and **never while
it holds work existing nowhere else**:

```
git -C <worktree> status --short
git -C <worktree> log --oneline <base>..HEAD
git -C <worktree> stash list
```

If any of those return something, stop and report it. Do not force the removal
and do not decide on your own that the work is disposable.

## Stop and ask

- pushing, publishing, or anything that leaves the machine, if not already authorized;
- deleting a branch, worktree, volume or environment that may hold unique work;
- changing the project's own Compose file, Dockerfile or `.env`;
- widening the work beyond the issue.
