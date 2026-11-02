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
- **No repository gets to run code.** The directory is named by a label any container
  can carry, and a repository's own configuration can name commands that git runs even
  to read: a clean filter during `status`, `core.fsmonitor`, a signature program during
  `log`, a remote's helper. So the repository's local settings are read first, never the
  owner's, and one that sets any such key is **not read at all**. The settings checked are
  the ones git then uses: the collector copies the repository's configuration once, through
  a descriptor it checked (a regular file of its user, of a fixed small size, never a link),
  checks the copy key by key from NUL-separated records, and points git at a private directory that holds that copy and links to the
  rest, so a container that edits the file in between changes nothing. A repository that
  names another work tree (`core.worktree`), a bare one, and a linked work tree or
  submodule, whose repository lives elsewhere, are not read. On top of that,
  `core.fsmonitor` and the hooks path are overridden, signatures and submodules are
  ignored, `protocol.allow` is `never`, lazy fetching is off, bare repositories need to be
  explicit, prompts are off, and each call times out.
- **Not any directory.** The label is not taken at its word. A project whose containers
  disagree about it has no folder, a path inside Portta's own installation has none (also
  through a link), and neither has one the collector's user does not own, which is also
  git's own rule for a repository, or whose user the collector cannot tell. The folder must
  also hold the Compose files the containers say Compose read
  (`com.docker.compose.project.config_files`), so a label that names some other folder
  without one is not followed, and a folder that two projects both name is given to
  neither. These catch a label that is wrong or careless. They do not prove who wrote it:
  whoever can start a container on the host can write any label, and the collector has no
  record of its own to compare it with. What is left is metadata of repositories that user
  already owns, shown to people who may read the host's metrics.
- **Nothing large.** Every string a repository supplies is cut to a fixed size, so a
  repository cannot make the snapshot large.
- **No content.** File names and their status, never what is in them. Reading files
  is a different decision, and a larger one.

A directory that is not a work tree git can read, or a host without git, gives no
reading and the screen shows nothing, rather than an error.

## Consequences

**The README says what is true.** Portta does not manage git; it reads the state of the
repository of a project it runs, on the host, without contacting any remote.

**Who sees what.** `/api/metrics/current` is the host's, but what is per project, its
use, its disk and its code, is returned only for the projects a person's scope sees,
with Portta's own. The host's totals stay whole, and what they do not see counts as the
system in them.

**The cost is bounded.** Each directory is read at most every thirty seconds, however
often the collector runs, and a slow repository costs five seconds and not the loop.

**A snapshot written by an older collector has no Git fields.** They are optional,
and the card is absent until the collector is updated.
