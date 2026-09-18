# Dev Container environment fixture

This fixture is the live compatibility target for Taskflow environments. It deliberately publishes no host ports: two copies can use the same internal ports and must be distinguished by their Compose project/environment identity.

Validated baseline: Node 24, `@devcontainers/cli` 0.89.0, Docker 29 and Docker Compose 5. The backend exposes HTTP, SSE and WebSocket on 8080, the frontend exposes HTTP on 3000, and PostgreSQL remains private on 5432. `packages/host/src/modules/taskflow/__tests__/devcontainer-environment.live.test.ts` is the executable acceptance test.
