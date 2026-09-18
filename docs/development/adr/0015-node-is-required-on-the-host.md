# 0015. Node 24 is required on the host

**Status:** Accepted

## Decision

Portta requires Node 24 or newer and npm on the host, in development and in
CI. The requirement gives the CLI, setup flow and checkout launcher one
executable implementation, and one Node major shared by the host, the panel
image and CI. Every workspace declares `engines.node` as `>=24`.

Installation is `npx @codions/portta setup`, which refuses an older Node before
changing the host. It does not install operating-system packages or provide
another command implementation. Docker Engine 24+ with Compose v2 remains
required for gateway operations.

## Consequences

- Every documented command follows the TypeScript CLI path.
- A release contains a self-contained CLI bundle and its runtime assets.
- Unsupported Node versions fail before installation changes the host.
- The host, the panel image and CI share one Node major, so no part of the
  product is tested on a runtime another part does not use.
- Code may use Node 24 APIs without a fallback for older runtimes.
