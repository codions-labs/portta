# The working agreement

Portta is opinionated about *how* work happens, not about which tool does it.
The same rules — where a branch comes from, what a commit says, when a worktree
may be removed, what counts as done — apply whether the work is yours, Claude
Code's, Codex's, or an agentic development environment's.

Those rules live in one place: the **`portta-method` skill**, at
[`skills/portta-method/SKILL.md`](https://github.com/codions-labs/portta/blob/main/skills/portta-method/SKILL.md)
in this repository. It is plain Markdown, so it reads as documentation and
installs as a skill. There is no second copy to drift from it.

## Why it is a skill and not a document

A document is something a person is expected to have read. A skill is something
an agent loads when it starts a task that needs it.

Distributing the method as a skill means every agent you use follows it without
you pasting instructions into each one, and changing a rule changes it for all
of them at once. It also means the method travels: it is not tied to Portta
running, to a particular editor, or to a particular agent vendor.

The skill is self-contained by design. It never points at files in this
repository, because once installed it lives in an agent's skills directory
where those files do not exist.

## Installing it

With the [Skills CLI](https://www.skills.sh):

```bash
npx skills add codions-labs/portta --skill portta-method -g
```

`-g` installs it for every project. Omit it to install for the current project
only. `npx skills update` refreshes it; `npx skills list` shows what is
installed.

Portta publishes seven skills:

| Skill | What it carries |
| --- | --- |
| `portta-method` | branches, worktrees, test scope, and what done means |
| `portta-commit` | selective staging, commit format, hooks |
| `portta-pull-request` | opening and updating PRs, verified labels, issue linkage |
| `portta-issue` | writing issues, duplicate search, closing with a reason |
| `portta-resolve-issue` | an issue from assignment to merged pull request |
| `portta-workflows` | authoring and running multi-agent workflows |
| `portta-adopt-compose` | adopting a Compose project through the CLI's closed verbs, and what to ask before each decision |

Install them all with `npx skills add codions-labs/portta -g`.

## What it covers

Branch naming and where branches come from; where worktrees live, how they are
created, and the rule that a worktree holding unique work is never removed;
Conventional Commits and the subject style this repository uses; when a pull
request is required and how it is merged; how far to scope tests; when
documentation changes; the five conditions that make work done; and the
decisions an agent must bring back to a person instead of taking alone.

## Changing a rule

Edit the skill, and the change reaches every agent on the next
`npx skills update`. A project may override any of it through its own
instruction files — the skill defers to the repository it is working in.

For rules specific to developing Portta itself, see
[AGENTS.md](https://github.com/codions-labs/portta/blob/main/AGENTS.md) and
[Testing](../../development/testing.md).
