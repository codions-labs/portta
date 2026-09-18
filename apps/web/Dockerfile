# =============================================================================
# Portta: administration panel
# =============================================================================
# Build context is the repository root so npm workspaces can install from the
# single lockfile. The runtime stage carries the built server, the built pages
# and the production dependencies only: no compiler, no source, no Docker CLI,
# and no access to the Docker socket. The panel reaches Docker exclusively
# through its own socket proxy over an internal network.
#
# The panel is composed from seven packages, and they build in dependency order:
# core → contracts → mcp → db → auth → server → web. Skipping one leaves the next
# resolving a dist/ that does not exist, because `next build` runs under
# NODE_ENV production, where the `development` export condition no longer
# applies.
# =============================================================================

FROM node:24.20.0-alpine AS deps
WORKDIR /app
# python3, make and g++ compile better-sqlite3, which the panel's own database
# is (ADR 0037) as well as the host daemon's; the runtime stage installs only
# the panel's workspaces and compiles it again there.
RUN apk add --no-cache openssh-client python3 make g++
COPY package.json package-lock.json ./
COPY apps/auth/package.json ./apps/auth/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/server/package.json ./packages/server/
COPY packages/cli/package.json ./packages/cli/
COPY packages/host/package.json ./packages/host/
# Install the whole workspace graph. Filtering with --workspace drops optional
# native bindings the Alpine build needs.
RUN npm ci

# --- build -------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
ARG PORTTA_REVISION
ENV PORTTA_REVISION=$PORTTA_REVISION
COPY packages/core/tsconfig.json packages/core/tsconfig.build.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.build.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY packages/mcp/tsconfig.json packages/mcp/tsconfig.build.json ./packages/mcp/
COPY packages/mcp/src ./packages/mcp/src
COPY packages/db/tsconfig.json packages/db/tsconfig.build.json ./packages/db/
COPY packages/db/src ./packages/db/src
COPY packages/db/drizzle ./packages/db/drizzle
COPY packages/auth/tsconfig.json packages/auth/tsconfig.build.json ./packages/auth/
COPY packages/auth/src ./packages/auth/src
COPY packages/server/tsconfig.json packages/server/tsconfig.build.json ./packages/server/
COPY packages/server/src ./packages/server/src
COPY apps/auth/tsconfig.json apps/auth/tsconfig.build.json apps/auth/tsconfig.ui.json apps/auth/vite.config.ts ./apps/auth/
COPY apps/auth/src ./apps/auth/src
COPY apps/auth/ui ./apps/auth/ui
COPY apps/web/tsconfig.json apps/web/next.config.ts apps/web/postcss.config.mjs apps/web/esbuild.server.ts ./apps/web/
COPY apps/web/app ./apps/web/app
COPY apps/web/components ./apps/web/components
COPY apps/web/lib ./apps/web/lib
COPY apps/web/modules ./apps/web/modules
COPY apps/web/messages ./apps/web/messages
COPY apps/web/server ./apps/web/server
COPY apps/web/public ./apps/web/public
# Canonical sources compile into static Next pages and a shared offline corpus.
# Only the validated corpus and local images reach the runtime stage.
COPY docs ./docs
COPY tooling ./tooling
COPY README.md CHANGELOG.md .env.example ./
RUN npm run build --workspace=portta-core \
 && npm run build --workspace=portta-contracts \
 && npm run build --workspace=portta-mcp \
 && npm run build --workspace=portta-db \
 && npm run build --workspace=portta-auth-core \
 && npm run build --workspace=portta-server \
 && npm run build --workspace=portta-auth \
 && npm run build --workspace=portta-web

# --- development -------------------------------------------------------------
# Used by docker/compose/features/web-dev.yaml, which bind-mounts the source
# over /app and runs the panel with `tsx watch`. One container, one port: HMR
# arrives on the same 8081 the API answers on.
FROM deps AS dev
WORKDIR /app
ARG PORTTA_VERSION
ENV NODE_ENV=development \
    PORTTA_RUNTIME_VERSION=$PORTTA_VERSION
COPY apps/web ./apps/web
COPY apps/auth ./apps/auth
# The workspace symlinks npm ci created point at these packages, so their source
# has to be here too: this stage never builds them, and the `development` export
# condition resolves each as TypeScript.
COPY packages/core/tsconfig.json ./packages/core/
COPY packages/core/src ./packages/core/src
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY packages/contracts/src ./packages/contracts/src
COPY packages/mcp/tsconfig.json ./packages/mcp/
COPY packages/mcp/src ./packages/mcp/src
COPY packages/db/tsconfig.json ./packages/db/
COPY packages/db/src ./packages/db/src
COPY packages/db/drizzle ./packages/db/drizzle
COPY packages/auth/tsconfig.json ./packages/auth/
COPY packages/auth/src ./packages/auth/src
COPY packages/server/tsconfig.json ./packages/server/
COPY packages/server/src ./packages/server/src
COPY docs ./docs
COPY tooling ./tooling
COPY README.md CHANGELOG.md .env.example ./
WORKDIR /app/apps/web
# The container runs as an unprivileged user, and Next writes .next beside the
# source it was given.
RUN chown -R node:node /app
# Which unprivileged user is not known here.
#
# The panel container takes PORTTA_WEB_USER so it can write the host's
# owner-only `.env` — that is the whole reason it exists — and in development
# the same process also writes inside the image: the build cache, and the
# `next-env.d.ts` Next regenerates on every start. Those belong to `node`, and
# the operator's uid is whatever their host gave them.
#
# So the panel's own directory is writable by any uid, in this stage and no
# other. It holds source the operator already owns and has bind-mounted over,
# on their own machine; the runtime stage below stays `node`-owned and is the
# one that ships.
RUN mkdir -p /app/apps/web/.next /app/apps/auth/dist \
 && chmod -R a+rwX /app/apps/web /app/apps/auth
USER node
EXPOSE 8081
# Through the package script, so `--conditions=development` is declared once.
CMD ["npm", "run", "dev"]

# --- runtime -----------------------------------------------------------------
FROM node:24.20.0-alpine AS runtime
WORKDIR /app
ARG PORTTA_VERSION
ENV NODE_ENV=production \
    PORTTA_RUNTIME_VERSION=$PORTTA_VERSION
LABEL org.opencontainers.image.title="Portta" \
      org.opencontainers.image.description="Administration panel for Portta" \
      org.opencontainers.image.version="$PORTTA_VERSION" \
      org.opencontainers.image.source="https://github.com/codions-labs/portta" \
      org.opencontainers.image.licenses="MIT"
COPY package.json package-lock.json ./
COPY apps/auth/package.json ./apps/auth/
COPY apps/web/package.json ./apps/web/
COPY packages/core/package.json ./packages/core/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/mcp/package.json ./packages/mcp/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/server/package.json ./packages/server/
COPY packages/cli/package.json ./packages/cli/
COPY packages/host/package.json ./packages/host/
# better-sqlite3 compiles here: the panel opens its own SQLite database, and
# Drizzle's driver imports it from the ROOT node_modules — which is why the
# build is asserted rather than assumed. A nested copy under packages/db would
# be deleted with portta-host below and the panel would fail at first boot with
# a module-not-found nobody would connect to this line (ADR 0037). The
# toolchain is removed again, and so is what only the host daemon loads — its
# own tree and the agent SDKs it hoists — because the panel never imports
# portta-host: that runs on the host, not in this image.
RUN apk add --no-cache openssh-client \
 && apk add --no-cache --virtual .native-build python3 make g++ \
 && npm ci --workspace=portta-web --workspace=portta-auth --omit=dev \
 && test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node \
 && rm -rf packages/host/node_modules node_modules/@agentclientprotocol node_modules/@anthropic-ai \
    node_modules/@openai node_modules/@devcontainers node_modules/pi-acp \
 && apk del .native-build \
 && npm cache clean --force
COPY --from=build /app/apps/auth/dist ./apps/auth/dist
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/mcp/dist ./packages/mcp/dist
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/auth/dist ./packages/auth/dist
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY apps/web/next.config.ts ./apps/web/
COPY apps/web/public ./apps/web/public
# The generated SQL, beside the dist that resolves it: the panel applies pending
# migrations at boot, so the image has to carry them.
COPY packages/db/drizzle ./packages/db/drizzle
# The validated corpus and local assets, from the same build as the panel.
COPY --from=build /app/docs/.generated ./docs/.generated
COPY --from=build /app/docs/images ./docs/images
COPY .env.example ./

WORKDIR /app/apps/web
USER node
EXPOSE 8081

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:8081/api/health || exit 1

CMD ["node", "dist/server.mjs"]
