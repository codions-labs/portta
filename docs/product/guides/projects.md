# Manage projects

## Projects

Every page below is a route, not a tab held in memory: `/projects`,
`/projects/<slug>`, `/projects/<slug>/environments`, and so on. Each one is a link
somebody can paste, a bookmark that survives a reload, and a step the browser's
back button walks. What a role may not do is not shown rather than shown
disabled.

![Authentication disabled: Projects as cards for Demo Shop, Demo A and Demo Monorepo, each with its state, resources and environments](../../images/auth-disabled-projects.png)

**Authentication disabled**: Projects as cards.

The products you recognise, as cards or as a table: running environments,
health and resources. **New project** creates one from a name, a slug and a
description; the slug is also what an environment's `portta.project` label must
say to be adopted automatically. A Project may be tied to a directory under
Projects Home at any depth; when two Projects contain a Compose directory, the
deepest one wins. A Project needs the panel's database and the
page says so when it is unavailable. `All environments` lists every Compose
project Docker is running, adopted or not.

Both views are places to act, not only to look. A card carries the one action
its state allows (start what is stopped, stop what is running) and a menu
with the rest: environments, settings, archive, delete. An action that could
not change anything is not offered.

The table sorts on any column, hides the ones a given host does not care about,
and selects rows for a bulk start, stop, restart or archive. The arrangement is
remembered per table. Nothing destructive happens without saying what it will
do: stopping a project names its environments and counts its containers,
and deleting one asks for its slug and states what survives.
The panel classifies a Project's location against Projects Home by comparing
paths the host reported; it never mounts Projects Home or any project
directory.

Opening a Project is the cockpit. The header carries its health and an
**Open / Test** menu for its primary environment; below it, tabs that are URLs:

| Tab | What it holds |
|---|---|
| **Overview** | The environments with their services and an Open / Test each, and the resources the project uses |
| **Environments** | The environments adopted, why each was adopted (manual, label or path), and **Adopt** for one that was not |
| **Settings** | Name, description, place under Projects Home, archive, and delete, which removes what only Portta holds and names it |

Deleting a Project never touches a container, a volume, a network or the
project's directory: its environments go back to unassigned.
