# 0031. Projects and environments are distinct

**Status:** Accepted

A Project is the product being developed and is persisted by the panel. It
groups running environments. An Environment is a Compose project observed on
the host.

`PORTTA_PROJECTS_HOME` names the root under which a Project's directory lives,
at any depth. The panel receives the directory as a relative path; it does not
mount the whole tree. Environment adoption is explicit (`manual`), derived from
the `portta.project` label (`label`), or derived from the environment's working
directory (`path`).

The public surfaces use `/api/projects`, `/api/environments`, `portta projects`
and `portta envs` consistently.
