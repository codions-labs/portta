# 0056. The collector reads where a project's code stands, and only reads

**Status:** Accepted; see [0001](0001-decoupled-infrastructure.md),
[0030](0030-the-panel-and-a-project-lifecycle.md),
[0055](0055-portta-routes-and-protects-agents-do-the-work.md)

## Context

Somebody looking at a running project wants to know what they are looking at: which
branch, which commit, whether something is not committed and whether something is not
pushed. Without that, the running site and the code on disk drift apart without a
word, and the person goes to the terminal to find out.

[0055](0055-portta-routes-and-protects-agents-do-the-work.md) says Portta does not
manage git, and that stays true: it does not commit, branch, push, pull, fetch, clone
or resolve anything. Reading is not managing, but the sentence was written without
saying so, and a reader could take it either way.

[0001](0001-decoupled-infrastructure.md) and [0030](0030-the-panel-and-a-project-lifecycle.md)
say the panel never mounts a project's directory. That also stays true.

## Decision

The **host collector** reads each Compose project's working directory, the one Compose
records in the `com.docker.compose.project.working_dir` label, with `git`, and writes
the result into the metrics snapshot it already writes. The panel only reads that
snapshot, as it does for CPU and memory. The panel mounts nothing and runs no `git`.

What is read: the branch (or that HEAD is detached), the upstream and how far ahead or
behind it, the last commit (short hash, subject, author, time), which files are changed
and which are new, and when something last changed.

What is never done:

- **No remote.** Nothing fetches or asks a network anything, so ahead and behind are
  as of the last fetch somebody did, and the screen says it read the host, not GitHub.
- **No write.** `GIT_OPTIONAL_LOCKS=0` keeps `status` from refreshing the index, and
  no command that changes a repository is run.
- **No repository gets to run code.** The directory comes from a label any container
  can carry, so `core.fsmonitor` (which a repository can point at a command) and the
  hooks path are overridden for every call, prompts are off, and each call times out.
- **No content.** File names and their status, never what is in them. Reading files
  is a different decision, and a larger one.

A directory that is not a work tree git can read, or a host without git, gives no
reading and the screen shows nothing, rather than an error.

## Consequences

**The README says what is true.** Portta does not manage git; it reads the state of the
repository of a project it runs, on the host, without contacting any remote.

**The cost is bounded.** Each directory is read at most every thirty seconds, however
often the collector runs, and a slow repository costs five seconds and not the loop.

**A snapshot written by an older collector has no Git fields.** They are optional,
and the card is absent until the collector is updated.
