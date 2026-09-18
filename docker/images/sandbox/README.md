# Portta Sandbox

The official universal sandbox image is published as:

```text
ghcr.io/codions-labs/portta-sandbox
```

It contains the four agent providers supported by Taskflow workflows: Codex,
Claude Code, OpenCode, and Pi. It also includes GitHub CLI, AWS CLI,
Playwright/Chromium, Mermaid CLI, asciinema, Git, Node.js 24 (the base image is
`node:24.20.0-bookworm-slim`), and common build utilities.

## Build locally

The build context is this directory. `TOOLS_REFRESH` invalidates the volatile
tool layer without invalidating the base OS/runtime layers.

```bash
docker buildx build \
  --load \
  --platform linux/arm64 \
  --build-arg SANDBOX_VERSION="$(tr -d '[:space:]' < VERSION)" \
  --build-arg TOOLS_REFRESH="$(date -u +%Y%m%dT%H%M%SZ)" \
  --tag portta-sandbox:local \
  .
```

Use `linux/amd64` on x86_64 hosts. Validate the result with:

```bash
docker run --rm --entrypoint /usr/local/lib/portta-sandbox/scripts/verify-image.sh portta-sandbox:local
docker run --rm --entrypoint cat portta-sandbox:local /etc/portta-sandbox/manifest.json
```

## Versions and tags

`VERSION` is the version of the sandbox architecture, not the versions of the
agents. A rebuild can keep the same sandbox version while resolving newer
stable agent releases.

- `rolling`: latest main-branch, scheduled, or manually refreshed build.
- `build-YYYYMMDD-<run-id>-<attempt>`: immutable build identity.
- `X.Y.Z`: immutable structural release.
- `X.Y`, `X`, and `latest`: aliases advanced only by a new structural release.

Publish a structural release by creating a GitHub Release whose tag is
`sandbox-vX.Y.Z`. The tag version must match `VERSION`. Re-running ordinary or
scheduled builds never overwrites `X.Y.Z` or `latest`; it advances `rolling`.

The exact versions in each architecture are stored at
`/etc/portta-sandbox/manifest.json`, uploaded as workflow artifacts, and
printed in the workflow summary. For strict rollback or reproduction, use the
image digest or an immutable `build-*` tag.

## Refresh and cache policy

The workflow supplies a unique `TOOLS_REFRESH` value for every run. Structural
layers remain cacheable, while signed APT repositories and npm stable tags are
resolved again for the volatile tools. No tool version edit or synthetic commit
is required: dispatch the workflow on `main` to refresh `rolling`.

A weekly Monday build refreshes the rolling image. Weekly, rather than daily,
limits two-architecture build minutes and immutable build-tag storage growth;
`workflow_dispatch` remains the fast path when an important agent release lands.

Claude Code is installed from Anthropic's signed stable APT channel. GitHub CLI
uses its signed stable APT repository. Codex, OpenCode, and Pi use the official
npm packages and their stable `latest` tags. A deliberate upstream regression
should be handled by temporarily pinning inside the affected agent installer,
then removing the pin after compatibility is restored.

## Image architecture

One universal image is published:

| Strategy | Decision |
| --- | --- |
| Universal image | Selected. It gives local, CI, VPS, and ephemeral environments the same warm toolset with no provisioning delay. |
| Base plus agent variants | Deferred until image size or an agent incompatibility is measured; combinations would otherwise multiply tags and builds. |
| Minimal base plus dynamic installs | Rejected as the default because startup would depend on registry availability and would be harder to audit and cache. |
| Runtime plugin layers | Kept as a possible future distribution mechanism if independent agent release/security policies become necessary. |

Agent installers are isolated files even though the delivered image is universal,
so a future variant can reuse the same scripts and BuildKit layers instead of
forking Dockerfiles.

## Sandbox version policy

Tool-only refreshes do not change `VERSION`. Bump its patch component for a
backward-compatible image/configuration fix, its minor component for a new
sandbox capability or supported agent, and its major component for a breaking
runtime contract. A future reproducible-build mode can consume a saved manifest;
until then, the immutable image digest is the exact replay and rollback identity.

## Adding an agent

Add one installer under `agents/`, call it from `scripts/install-tools.sh`, and
add its version command to `scripts/generate-manifest.mjs` and
`scripts/verify-image.sh`. Keep a single universal image until an agent has a
demonstrated incompatibility or size requirement that justifies a variant.

## Registry setup

The publish job uses `GITHUB_TOKEN` and grants `packages: write` only to that
job. The organization must allow GitHub Actions to create packages. After the
first publication, make the `portta-sandbox` package public in the GHCR
package settings; package visibility cannot be changed by the build workflow.
