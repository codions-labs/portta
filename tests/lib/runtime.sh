#!/usr/bin/env bash
# Test-only access to the installed runtime. Product behavior belongs to the
# TypeScript CLI; these helpers only keep Docker-backed assertions terse.

test_load_runtime() {
  # One process for every value: each reads .env through portta-core, and
  # starting Node once per key cost seconds at the top of every suite.
  eval "$(node --conditions=development --input-type=module - "$PORTTA_ROOT/.env" <<'NODE'
import { readFileSync } from 'node:fs'
import { parseEnv } from 'portta-core'
const defaults = {
  PORTTA_PROFILE: 'local', PORTTA_PROJECT_NAME: 'portta', PORTTA_NETWORK: 'portta',
  PORTTA_ACCESS_NETWORK: 'portta-access', PORTTA_WEB_NETWORK: 'portta-web',
  PORTTA_DOMAIN: 'localhost', PORTTA_BIND_ADDRESS: '127.0.0.1', PORTTA_HTTP_PORT: '80', PORTTA_HTTPS_PORT: '443',
  PORTTA_WEB_PORT: '8081', PORTTA_WEB: 'false', PORTTA_TCP: 'false', PORTTA_TCP_POSTGRES_PORT: '5432',
  PORTTA_TCP_REDIS_PORT: '6379', PORTTA_LOG_LEVEL: 'INFO', PORTTA_APPLY: 'false',
}
let env = new Map()
try { env = parseEnv(readFileSync(process.argv[2], 'utf8')) } catch {}
for (const [key, fallback] of Object.entries(defaults)) {
  process.stdout.write(`${key}='${String(env.get(key) ?? fallback).replaceAll("'", "'\\''")}'\n`)
}
NODE
)"
  PORTTA_TEST_EXAMPLES="$PORTTA_ROOT/tests/fixtures/examples"
  export PORTTA_PROFILE PORTTA_PROJECT_NAME PORTTA_NETWORK PORTTA_ACCESS_NETWORK
  export PORTTA_WEB_NETWORK PORTTA_DOMAIN PORTTA_BIND_ADDRESS
  export PORTTA_HTTP_PORT PORTTA_HTTPS_PORT PORTTA_WEB_PORT PORTTA_WEB
  export PORTTA_TCP PORTTA_TCP_POSTGRES_PORT PORTTA_TCP_REDIS_PORT
  export PORTTA_LOG_LEVEL PORTTA_APPLY
  export PORTTA_TEST_EXAMPLES
}

test_example_dir() { printf '%s/portta-%s\n' "$PORTTA_TEST_EXAMPLES" "$1"; }

test_env_set() {
  node --conditions=development --input-type=module - "$PORTTA_ROOT/.env" "$1" "$2" <<'NODE'
import { patchEnvFile } from 'portta-core'
patchEnvFile(process.argv[2], { [process.argv[3]]: process.argv[4] })
NODE
}

test_require_docker() { docker info >/dev/null 2>&1; }
test_have() { command -v "$1" >/dev/null 2>&1; }
test_is_true() { case "${1:-}" in true|1|yes|on) return 0 ;; *) return 1 ;; esac; }
test_file_mode() {
  if stat -c '%a' "$1" >/dev/null 2>&1; then stat -c '%a' "$1"
  else stat -f '%Lp' "$1"
  fi
}
test_container_state() { docker inspect "$1" --format '{{.State.Status}}' 2>/dev/null; }
test_container_health() { docker inspect "$1" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null; }
test_network_exists() { docker network inspect "$1" >/dev/null 2>&1; }
test_gateway_container() {
  if [ "$1" = apply ]; then
    docker ps -aq --filter 'label=portta.component=apply' | head -1
    return
  fi
  docker ps -aq \
    --filter "label=com.docker.compose.project=$PORTTA_PROJECT_NAME" \
    --filter "label=portta.component=$1" | head -1
}

# test_wait_until <seconds> <command...>: poll until the command succeeds, or
# give up. A fixed `sleep` is a guess about how slow the machine is, and it is
# wrong in both directions: too long on a workstation, too short on a loaded CI
# runner, where it turns a passing assertion into a flake nobody can reproduce.
test_wait_until() {
  local deadline=$(( $(date +%s) + $1 )); shift
  until "$@" >/dev/null 2>&1; do
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 0.5
  done
}

# test_http_code <url>: resolves the hostname to the gateway's bind address
# explicitly. Routing and name resolution are separate concerns: `doctor`
# checks that *.localhost resolves, and these suites check that Traefik routes,
# so they keep working on hosts and CI runners whose resolver does not
# implement RFC 6761 for localhost subdomains.
test_http_code() {
  local url="$1" host port="$PORTTA_HTTP_PORT"
  host=$(printf '%s' "$url" | sed -e 's#^https\{0,1\}://##' -e 's#[:/].*$##')
  case "$url" in https://*) port="$PORTTA_HTTPS_PORT" ;; esac
  curl -sk -o /dev/null -w '%{http_code}' --max-time 10 \
    --resolve "${host}:${port}:${PORTTA_BIND_ADDRESS}" "$url"
}

# test_route_is <url> <code>: for test_wait_until, since Traefik learns about
# containers from Docker events, which is fast but not instant.
test_route_is() { [ "$(test_http_code "$1")" = "$2" ]; }

# The toolbox the CLI builds for this checkout, whatever version it carries.
test_toolbox_ensure() {
  PORTTA_TOOLBOX_IMAGE=$("$PORTTA_ROOT/bin/portta" toolbox build --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["image"])')
  export PORTTA_TOOLBOX_IMAGE
}

# test_toolbox_start [docker run options...]: one long-lived client on the host
# network, so every probe is a `docker exec` instead of a new container. The
# path a query takes is the same one a GUI client on the host would take.
test_toolbox_start() {
  test_toolbox_ensure || return 1
  PORTTA_TOOLBOX=$(docker run -d --rm --network host --label portta.e2e=toolbox "$@" "$PORTTA_TOOLBOX_IMAGE" sleep 86400) || return 1
  export PORTTA_TOOLBOX
}
test_toolbox_stop() { [ -z "${PORTTA_TOOLBOX:-}" ] || docker rm -f "$PORTTA_TOOLBOX" >/dev/null 2>&1; }
