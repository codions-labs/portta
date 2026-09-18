# A disposable host for external gateway scenarios. Its daemon has no host socket
# or host bind mounts; all destructive lifecycle effects stay inside this host.
FROM node:24.20.0-alpine
# Compile better-sqlite3 during the workspace install inside this disposable host.
# tmux is the multiplexer Taskflow sessions run in: without it, or herdr,
# `portta doctor` reports a failed check and the lifecycle suite sees a host
# that no operator would call healthy.
RUN apk add --no-cache bash docker docker-cli docker-cli-buildx docker-cli-compose git python3 make g++ curl openssl jq coreutils util-linux iptables ca-certificates tmux
VOLUME /var/lib/docker
WORKDIR /work
CMD ["dockerd", "--host=unix:///var/run/docker.sock"]
