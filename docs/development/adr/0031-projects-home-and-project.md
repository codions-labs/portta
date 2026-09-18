# 0031. Projects, repositories and environments are distinct

**Status:** Accepted

A Project is the product being developed and is persisted by the panel. It can
own multiple repositories and running environments, and points at where its
work lives ([ADR 0050](0050-work-lives-in-an-external-provider.md)). A
Repository is a code location with a remote. An Environment is a Compose
project observed on the host.

`PORTTA_PROJECTS_HOME` names the root under which the CLI discovers managed
repositories. The panel receives normalized project and repository coordinates;
it does not mount the whole directory. Environment adoption is explicit or
derived from the current `portta.project` label and repository coordinates.

The public surfaces use `/api/projects`, `/api/environments`, `portta projects`
and `portta envs` consistently.
