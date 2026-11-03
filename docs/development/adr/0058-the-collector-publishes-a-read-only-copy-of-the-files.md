# 0058. The collector publishes a read-only copy of a project's files

**Status:** Accepted; see [0001](0001-decoupled-infrastructure.md),
[0030](0030-the-panel-and-a-project-lifecycle.md),
[0056](0056-the-collector-reads-where-the-code-stands.md)

## Context

Somebody looking at a project in the panel wants to see its files: what is there, what changed
since the last commit, and the text of a file. Without it they open a terminal for a thing they can
see on the page. ADR 0001 and ADR 0030 say the gateway does not mount a project's directories, and
the panel runs in a container that can see none of them. The panel has no way to ask the host for a
file, and giving it one would make the panel a way into the host's disk.

## Decision

The collector, which already runs on the host and already reads a project's folder for ADR 0056,
publishes a bounded copy of what is safe to show, and the panel reads the copy.

* **Where.** `state/files/<environment>/` holds `index.json`, `blobs/<hash>` for the text of a file
  and `diffs/<hash>` for its changes against the last commit. The name of a blob is a hash of its
  path, so the panel finds a file by the index and never builds a path from a request. The directory
  is mounted into the panel read-only: there is no request channel from the panel to the host.
* **What is listed.** What git lists for the folder, tracked and untracked; ignored files and folders
  appear as a single line (`node_modules`) and are never looked into.
* **What is copied.** The text of a regular file inside the folder, up to 64 KB, 400 files and 8 MB
  per project, the changed files first. A file is opened through a descriptor that does not follow a
  link and its real path must lie inside the folder, so a link out of the project reads nothing.
  Binary and large files are listed and not copied. A patch is kept only when every line it
  keeps from the new version is a line of the text that was read, because git reads the path again.
* **What is never copied.** A file that usually holds a secret, by name: `.env` and its variants
  (but not `.env.example`), keys and certificates, `.npmrc`, credentials and secrets files,
  Terraform state and variables, and anything under `.ssh`, `.aws`, `.gnupg`, `.kube` or `.docker`.
  The panel lists them and says their content is hidden. The same rule is applied again when the
  panel reads, so a copy that somehow holds one is still not served.
* **Which repository.** One whose `objects`, `refs`, `index`, `packed-refs` and `shallow` are what they
  say they are (real folders and files of the collector's user, never links), with no borrowed
  objects (`objects/info/alternates`) and no unreadable `info/exclude`. Anything else is not read.
* **Which folder.** The one ADR 0056 trusts (its own user's, holding the Compose files the containers name, outside Portta), and git is held on the same short lead: a private copy
  of the repository's checked configuration, no external diff driver or text conversion, no hooks.
* **Who reads.** Whoever may read the project (`project:read`, within their projects). Every read of
  a file is a line in the audit log (`project_file.read`) with the environment and path.

## Consequences

* The folder is found from a label the containers carry, as in ADR 0056. Anyone who can start a
  container with a forged label already controls the host's Docker, so this adds no new reach, but
  it does mean the copy is as trustworthy as that label check and no more.
* What git is told to ignore, including the owner's own `.git/info/exclude`, is left out and listed
  as ignored. A file git does not ignore and whose name looks harmless is copied, tracked or not.

* The panel never shows a project's files live: what it shows is as old as the last publication,
  every half minute while the project runs. A file saved a second ago is not there yet.
* A secret that is not named like one, such as a token pasted into `notes.md`, is shown to everyone
  who may read the project. The copy lowers the exposure and does not remove it. Nothing here
  decides what a file means.
* Disk use is bounded per project and removed with the environment.
* Changing the limits or the list of names is a change to this decision.
* ADR 0001 and 0030 still hold: nothing is mounted into the gateway and nothing is written to a
  project. What changes is that Portta now keeps a copy of some of its files, under its own state.
