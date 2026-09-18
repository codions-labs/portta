# syntax=docker/dockerfile:1.7

FROM node:24.20.0-bookworm-slim

ENV AWS_DEFAULT_REGION=auto \
    DEBIAN_FRONTEND=noninteractive \
    DISABLE_UPDATES=1 \
    NPM_CONFIG_PREFIX=/usr/local \
    PATH="/root/.local/bin:/usr/local/bin:/root/.bun/bin:/root/.cargo/bin:${PATH}" \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORTTA_FLOW_SANDBOX_MANIFEST=/etc/portta-sandbox/manifest.json

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        curl \
        git \
        gnupg \
        groff \
        jq \
        less \
        openssh-client \
        ripgrep \
        sudo \
        unzip \
    && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH
ARG ASCIINEMA_VERSION=3.2.1
ARG ASCIINEMA_SHA256_AMD64=1b405bbda565b33c3c4718de67fedc3535580603c0694b1ff3fb04f363430a20
ARG ASCIINEMA_SHA256_ARM64=b516a6d896844c0ffbc96e0a55afe4cbcc79216abde0fc64fdda4e39bee421ea

RUN case "${TARGETARCH}" in \
        amd64) target=x86_64; sha256="${ASCIINEMA_SHA256_AMD64}" ;; \
        arm64) target=aarch64; sha256="${ASCIINEMA_SHA256_ARM64}" ;; \
        *) echo "Unsupported asciinema architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL -o /usr/local/bin/asciinema \
        "https://github.com/asciinema/asciinema/releases/download/v${ASCIINEMA_VERSION}/asciinema-${target}-unknown-linux-gnu" \
    && echo "${sha256}  /usr/local/bin/asciinema" | sha256sum -c - \
    && chmod 0755 /usr/local/bin/asciinema

COPY --chmod=0755 agents/ /usr/local/lib/portta-sandbox/agents/
COPY --chmod=0755 scripts/ /usr/local/lib/portta-sandbox/scripts/

ARG BUILD_DATE=unknown
ARG BUILD_ID=local
ARG SANDBOX_VERSION=dev
ARG TOOLS_REFRESH=local
ARG VCS_REF=unknown

# TOOLS_REFRESH deliberately invalidates only the high-cadence tool layer.
RUN echo "Refreshing volatile tools: ${TOOLS_REFRESH}" \
    && TARGETARCH="${TARGETARCH}" /usr/local/lib/portta-sandbox/scripts/install-tools.sh \
    && install -d -m 0755 /etc/portta-sandbox \
    && SANDBOX_VERSION="${SANDBOX_VERSION}" \
       BUILD_DATE="${BUILD_DATE}" \
       BUILD_ID="${BUILD_ID}" \
       VCS_REF="${VCS_REF}" \
       node /usr/local/lib/portta-sandbox/scripts/generate-manifest.mjs "${PORTTA_FLOW_SANDBOX_MANIFEST}" \
    && /usr/local/lib/portta-sandbox/scripts/verify-image.sh

# Task Flow runs containers with the host UID/GID. Keep HOME traversable and
# writable while tools remain installed read-only under /usr/local.
RUN usermod -l agent -d /root -s /bin/bash node \
    && echo "agent ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent \
    && chmod -R 0777 /root /ms-playwright \
    && ln -sf /usr/local/lib/portta-sandbox/scripts/entrypoint.sh /usr/local/bin/entrypoint.sh

LABEL org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.description="Universal Portta agent sandbox" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.source="https://github.com/codions-labs/portta" \
      org.opencontainers.image.title="Portta Sandbox" \
      org.opencontainers.image.version="${SANDBOX_VERSION}"

CMD ["sleep", "infinity"]
