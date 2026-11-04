# 0059. The collector finds and reviews project folders

**Status:** Accepted; see [0001](0001-decoupled-infrastructure.md),
[0031](0031-projects-home-and-project.md),
[0056](0056-the-collector-reads-where-the-code-stands.md),
[0058](0058-the-collector-publishes-a-read-only-copy-of-the-files.md)

## Context

Adding a project from the panel used to be a page that told the person to go to a terminal. The
panel never opens Projects Home (ADR 0031) and cannot ask the host to, and the runner it can ask
accepts a closed list of Compose verbs (ADR 0030). Reading a folder the person names would make the
panel a way to read any folder on the host.

## Decision

The collector finds the folders, analyses them and publishes the result. The panel reads it.

* **Finding.** The collector lists the folders under Projects Home (`PORTTA_PROJECTS_HOME` in
  `.env`, else `~/projects`, `/srv/projects` for root) that hold a Compose file, at most three levels
  down, never through a link, skipping hidden folders and dependency folders, and not descending into
  a folder that already is one. It stops at 200.
* **What it will walk.** Projects Home must be a folder somebody keeps projects in: at least two
  levels deep, not part of the system (`/etc`, `/proc`, `/sys`, `/dev`, `/boot`, Docker's own
  directories), not a whole account (`/root`, `/home`, `/home/ada`) and not a hidden folder. `/root/projects` is a place for
  projects; `/root` and `/root/.ssh` are not. Anything else publishes nothing.
* **Analysing.** For each it runs the same read-only analysis as `portta envs analyze` and publishes the
  plan: services, how each would be routed, the ports that would stop being published, fixed container
  names and who on the host already holds them, and a namespace in use by another folder. A Compose file that makes Compose fetch something (`oci://`,
  `git+`, a URL in `include` or `extends`) is listed and not analysed, because the collector does this on
  its own and must not download anything. It re-analyses
  a folder when its Compose file changes or every five minutes, at most eight a cycle. The running
  collector publishes every minute, in the background: a slow folder never delays the host's metrics.
  Unlike the command, the analysis is unattended: Compose is run with `--no-interpolate` and a
  20-second deadline (killed, not asked), so no variable of the host or of a `.env` reaches the plan.
  The Compose file and the `.env` are read through one descriptor and refused when they are a link, a pipe or
  too large (1 MB, 64 KB); an `include` or `extends` that leaves the folder is treated like one that fetches.
  Such a folder is listed with no plan and the reason goes to the collector log.
* **Where.** `state/discovery/folders.json` and `state/discovery/plans/<hash of the path>`, mounted
  into the panel read-only. No path from a request is ever opened: the panel answers only for a folder
  that is in the collector's list, and refuses anything that is not a relative path of plain names.
* **What the page does.** The Add project page lists the folders and opens a review: the plan, who may
  open each site (password, everybody, decide later), what changes, and the name. **Register project**
  creates the project in the panel with that folder (`relativePath`); it starts nothing. The review also
  gives the exact `portta adopt` command, written against the absolute Projects Home the collector
  published, with the decisions as `--protect`/`--public`.
* **Who.** Whoever holds `settings:read`, which is the owner and administrators: the list reveals the
  layout of the host's disk.

## Consequences

* **Adopting is still done in the terminal.** The panel cannot start a project it did not create, and
  giving it that would mean a new runner verb and a way to hand it a folder. That is a separate
  decision; this one only makes the review and the registration possible from the panel.
* A folder listed without a plan says nothing about why in the panel; the reason is only in the
  collector log. Showing it needs a field in the contract.
* The list is as fresh as the last collector cycle. A folder just created appears within a minute, and
  one that was just edited keeps its old plan for up to five.
* Typing a path that is not in the list leaves the commands of the old page: the panel does not look.
* The plan is read from the project's own Compose file, so it is as trustworthy as that file. It is
  shown to people who may already read it on the host.
