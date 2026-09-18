# A disposable host for external gateway scenarios. Its daemon has no host socket
# or host bind mounts; all destructive lifecycle effects stay inside this host.
FROM node:24.20.0-alpine
# Compile better-sqlite3 during the workspace install inside this disposable host.
RUN apk add --no-cache bash docker docker-cli docker-cli-buildx docker-cli-compose git python3 make g++ curl openssl jq coreutils util-linux iptables ca-certificates
VOLUME /var/lib/docker
WORKDIR /work
CMD ["dockerd", "--host=unix:///var/run/docker.sock"]
