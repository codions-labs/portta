---
name: portta-issue
description: Write and open issues for a repository managed with Portta, sized as one deliverable with clear scope and acceptance criteria. Use when creating an issue, filing a bug, turning a request or idea into a tracked item, structuring or rewriting an existing issue, or checking for duplicates before filing. Covers repository templates, duplicate search, and the rule that no agent, model or tool is ever credited.
license: MIT
compatibility: Requires the gh CLI authenticated against the target repository, or an equivalent issue provider.
metadata:
  author: codions-labs
  version: "1"
---

# Writing issues

## Never credit a tool

Do not sign an issue, add a footer, badge or trailer naming an agent, model,
vendor or tool, and do not write it in a voice that announces it was generated.
The issue is the person's, written in the project's ordinary voice.

## Look before writing

Read the actual code and repository state before describing a problem. An issue
that describes a symptom you never reproduced, or proposes a change to code you
never opened, wastes the reader's time and is often wrong.

Verify the claim. If you cannot, say what you observed and what you assumed.

## Check for duplicates

Search before filing, including closed issues:

```
gh issue list --search "<keywords>" --state all --limit 30
```

Try more than one wording, and search the labels or areas involved. If a
matching open issue exists, report it and offer the new context instead of
filing again. Do not reopen or comment on a closed issue on your own.

A search that fails or returns nothing is not proof that no duplicate exists —
say which searches you ran.

## Use the repository's template

If the repository has issue templates, use the one that fits. It encodes what
the maintainers want to know.

Without a template, write a body proportionate to the work:

**Current state** — what exists today, with the concrete evidence. Name files,
commands or behaviour, not impressions.

**Objective** — what should be true afterwards, in one or two sentences.

**Scope** — what the work covers.

**Out of scope** — what it deliberately does not cover, and where that belongs
instead. This section prevents more rework than any other.

**Acceptance criteria** — checkable statements. Each one must be something a
reader can verify as done or not done. Avoid "works well" and "is improved".

**Dependencies** — issues or work this needs first, when any.

A small bug does not need all of these. Omit sections that would be empty
rather than filling them with filler.

## One issue, one deliverable

An issue represents one coherent piece of work. When a request contains several
independent deliverables, propose a split and let the person choose — do not
silently file one large issue or several without asking.

Do not expand a small request into architecture work. Recording an idea is not
authorization to implement it.

## Title

Say what the issue delivers or what is broken, specifically:

```
Retention and safe cleanup of Run worktrees and environments
A duplicate registration answers 500 instead of 409
```

Not `Improve cleanup` or `Fix bug`.

## Labels

Apply only labels that already exist:

```
gh label list --limit 100
```

Choose what the issue actually is and what area it touches. Do not create
labels, and do not set priority, size or triage labels unless the person asked.
If a label you want does not exist, say so and continue without it.

## Filing

Write the body to a UTF-8 file and pass it with `--body-file`:

```
gh issue create --title <title> --body-file <file> --label <label>
```

Return the issue number and URL.

## Closing an issue

When closing, leave a comment saying **what was delivered, what was
deliberately left out, and what remains open**, and link the pull request that
delivered it.

That comment is what explains, months later, why the issue ended where it did.
Closing without it loses the reasoning permanently.

Do not close an issue you were not asked to close, and do not close one on the
strength of a merged pull request alone — confirm the acceptance criteria
actually hold.
