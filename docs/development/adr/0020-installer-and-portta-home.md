# 0020. An installation is one runtime directory

**Status:** Accepted

`portta setup` installs the runtime assets bundled in the npm package into one
chosen directory. That directory owns `.env`, Compose files, configuration,
state and the installed launcher. It is not a Git checkout.

Setup preserves existing configuration and state, refuses unrelated non-empty
directories, creates only gateway-owned paths, prepares the shared networks,
pulls pinned images and starts the selected profile. Repeating setup is
idempotent. Development uses a checkout and local build overlays explicitly.
