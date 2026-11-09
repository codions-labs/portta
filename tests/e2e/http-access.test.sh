#!/usr/bin/env bash
# A secondary web panel is reached through its container port, without
# publishing SMTP or recreating the primary application.
set -euo pipefail
node "$(dirname "$0")/../lib/require-disposable.mjs"
PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime
GW="$PORTTA_ROOT/bin/portta"
BASE="http://127.0.0.1:${PORTTA_WEB_PORT}"
fixture=$(mktemp -d /tmp/portta-http-access.XXXXXX)
cp "$PORTTA_ROOT/.env" "$fixture/gateway.env"
initial_web="$PORTTA_WEB"
project=portta-http-access-e2e
overlay="$PORTTA_ROOT/runtime/compose/http-access/$project.yaml"
cleanup() {
  curl -fsS --max-time 5 -X DELETE -H "Origin: $BASE" \
    "$BASE/api/environments/$project/services/mailpit/alias" >/dev/null 2>&1 || true
  docker compose -p "$project" -f "$fixture/compose.yaml" down >/dev/null 2>&1 || true
  if ! test_is_true "$initial_web"; then
    "$GW" web down >/dev/null 2>&1 || true
  fi
  cp "$fixture/gateway.env" "$PORTTA_ROOT/.env"
  "$GW" up local --local-release >/dev/null 2>&1 || true
  rm -rf "$fixture"
}
trap cleanup EXIT

cat > "$fixture/compose.yaml" <<'YAML'
services:
  app:
    image: traefik/whoami:v1.12.0
    networks: [default, gateway]
    labels:
      traefik.enable: "true"
      traefik.docker.network: portta
      traefik.http.services.portta-http-access-e2e-app.loadbalancer.server.port: "80"
  mailpit:
    image: axllent/mailpit:v1.20.0
    expose: [1025, 8025]
networks:
  gateway:
    external: true
    name: portta
YAML
docker compose -p "$project" -f "$fixture/compose.yaml" up -d
app_before=$(docker compose -p "$project" -f "$fixture/compose.yaml" ps -q app)
mail_before=$(docker compose -p "$project" -f "$fixture/compose.yaml" ps -q mailpit)
test_env_set PORTTA_RUNNER true
"$GW" up local --local-release
"$GW" web up

write_api() {
  curl -fsS --max-time 15 -X "$1" -H 'Content-Type: application/json' \
    -H "Origin: $BASE" --data "$3" "$BASE$2"
}
service_path="/api/environments/$project/services/mailpit"
describe "HTTP access for a secondary service"
integration=$(write_api POST "$service_path/http-integration" '{"alias":"mailpit-panel.localhost","port":8025}')
request_id=$(printf '%s' "$integration" | python3 -c 'import json,sys; print(json.load(sys.stdin)["requestId"])')
operation_ready() {
  curl -fsS "$BASE$service_path/http-integration/$request_id" \
    | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["state"] == "ok" else 1)'
}
it "integrates the selected service through Compose"
assert_success test_wait_until 60 operation_ready
it "leaves the primary application running in its original container"
assert_eq "$app_before" "$(docker compose -p "$project" -f "$fixture/compose.yaml" ps -q app)"
it "recreates only the secondary service"
assert_ne "$mail_before" "$(docker compose -p "$project" -f "$fixture/compose.yaml" -f "$overlay" ps -q mailpit)"
it "publishes no port on the host"
assert_eq "0" "$(docker inspect "${project}-mailpit-1" --format '{{len .HostConfig.PortBindings}}')"

write_api PUT "$service_path/alias" '{"alias":"mailpit-panel.localhost","port":8025}' >/dev/null
it "routes the Mailpit panel through port 8025"
assert_success test_wait_until 30 test_route_is http://mailpit-panel.localhost/ 200
it "keeps the primary application route"
assert_success test_wait_until 30 test_route_is "http://$project--app.localhost/" 200
it "keeps SMTP available on the private network"
smtp=$(printf 'QUIT\r\n' | docker run --rm -i --network "${project}_default" alpine:3.24.1 nc -w 3 mailpit 1025 || true)
assert_contains "$smtp" '220'

mail_current=$(docker compose -p "$project" -f "$fixture/compose.yaml" -f "$overlay" ps -q mailpit)
retry=$(write_api POST "$service_path/http-integration" '{"alias":"mailpit-other.localhost","port":8025}')
it "reuses integration without another recreation"
assert_contains "$retry" '"ready":true'
assert_eq "$mail_current" "$(docker compose -p "$project" -f "$fixture/compose.yaml" -f "$overlay" ps -q mailpit)"
t_summary
