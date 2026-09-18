# ============================================================================
# Portta toolbox
# ============================================================================
# One small image holding the diagnostic and client tools the gateway needs, so
# a host only ever has to provide Docker, Git and a shell.
#
# Built on demand and cached locally; see `portta toolbox build`.
# ============================================================================
FROM alpine:3.24.1

ARG PORTTA_VERSION

# Pinned base, unpinned packages: Alpine's repositories only carry the current
# patch level for a release, so `apk add` inside 3.24.1 is already constrained.
RUN apk add --no-cache \
      bash \
      ca-certificates \
      curl \
      jq \
      bind-tools \
      openssl \
      socat \
      netcat-openbsd \
      openssh-client \
      postgresql-client \
      mysql-client \
      redis \
      iputils \
  && update-ca-certificates

LABEL org.opencontainers.image.title="portta-toolbox" \
      org.opencontainers.image.description="Diagnostic and client tools for Portta" \
      org.opencontainers.image.version="$PORTTA_VERSION" \
      org.opencontainers.image.source="https://github.com/codions-labs/portta" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT []
CMD ["/bin/bash"]
