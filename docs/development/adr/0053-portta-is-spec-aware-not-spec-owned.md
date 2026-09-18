# 0053. Portta is spec-aware, not spec-owned

**Status:** Accepted; see [0050](0050-work-lives-in-an-external-provider.md),
[0052](0052-the-portta-directory-is-the-project-contract.md)

## Context

Portta works on repositories that already carry documented intent: an
`AGENTS.md` or `CLAUDE.md`, a directory of architecture decision records,
sometimes an OpenSpec or Spec Kit tree. Those documents were written for the
people and agents that work on the project, in whatever convention the project
chose, and they keep being written after Portta is installed.

What Portta reads of them today is an allowlist, not a search.
`packages/core/src/repos-scan.ts` names the exact files
(`INSTRUCTION_FILES`: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`CONVENTIONS.md`, `.clinerules`, `.cursorrules`, `.windsurfrules`,
`.github/copilot-instructions.md`) and one bounded directory pattern
(`INSTRUCTION_DIRECTORIES`: `.cursor/rules/*.mdc`). `isInstructionPath`
admits a path only when it is on that list, refuses anything outside the
repository and a few names that are never instructions, and
`instructionAudience` labels each file with the agent it speaks to, as a hint
for the UI rather than a rule. The result carries provenance — path, size,
hash, whether the working tree differs from `HEAD`, the content when it fits
a bound — and is served unchanged by `GET /repositories/:id/instructions` and
folded into the Development Context. Nothing in that path writes to the
repository.

Spec-Driven Development frameworks exist and some adopted projects use one.
Making one of them the mandatory path would impose a format on every project
Portta adopts, including the majority that have no spec at all, and would tie
the core to the evolution of a third-party project Portta does not control.

## Decision

> **Portta discovers, references and uses the specifications a project
> already has. It defines no specification format of its own, requires no
> project to adopt Spec-Driven Development, and never writes to the source
> documents.**

Rigor is the user's choice, made per piece of work, never a requirement of
the product. A project may keep formal specifications, informal notes or
nothing, and Portta serves all three the same way: by reading what is there
and saying where it came from.

This is the third thing beside two that are already settled. Work lives in the
external provider and Portta stores a reference to it ([0050](0050-work-lives-in-an-external-provider.md)).
The project's own contract with Portta is `.portta/`
([0052](0052-the-portta-directory-is-the-project-contract.md)). Specifications
are neither: they belong to the project, in the project's format, and Portta
only reads them.

## Consequences

- **Interoperability.** Any convention enters through discovery, and any agent
  consumes the result. Adding a convention means adding a source, not
  teaching every project a new one.
- **No guarantee of completeness.** Portta does not own a specification, so it
  cannot promise one is complete or consistent. Conformance validation is out
  of scope by construction, not by omission.
- **No spec is the normal case.** A repository with nothing beyond its code is
  served without a warning, a nudge or an empty scaffold.
- **One discovery design.** New sources — a directory of decision records, an
  `openspec/` tree, a `.specify/` tree — join the same allowlist-and-provenance
  scan as the instruction files. There is no second mechanism, no heuristic
  search and no format-specific parser in the core.
- **Ambiguity is reported, never resolved by guessing.** When a source is
  absent or its shape cannot be told apart from another, the result says so.
  A wrong guess about which document governs a piece of work is worse than an
  honest gap.
- **The source documents stay the project's.** Anything Portta hands to an
  agent references a document by path and hash rather than copying it into a
  store of its own, and no Portta surface edits it.
