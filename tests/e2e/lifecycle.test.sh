#!/usr/bin/env bash
# ============================================================================
# E2E: lifecycle independence
# ============================================================================
# The gateway is shared infrastructure, so its lifecycle must not be entangled
# with any project's. Restarting or stopping it leaves applications running;
# starting it again rediscovers them.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime

GW="$PORTTA_ROOT/bin/portta"

up_demo() {
  ( cd "$(test_example_dir "$1")" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
}
down_demo() {
  ( cd "$(test_example_dir "$1")" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
}
# wait_for_route <url> <expected>: Traefik rediscovers asynchronously.
wait_for_route() { test_wait_until 30 test_route_is "$1" "$2"; }

# wait_for_health <container>: a freshly started container reports
# `starting` until its healthcheck has had a chance to run at least once.
container_healthy() { [ "$(test_container_health "$1")" = "healthy" ]; }
wait_for_health() { test_wait_until 40 container_healthy "$1"; }

cleanup() { down_demo demo-a; down_demo demo-b; "$GW" up local >/dev/null 2>&1; }

test_require_docker || { echo "Docker unavailable: E2E incomplete"; exit 1; }

trap cleanup EXIT INT TERM
describe "authentication runtime"
it "starts the gateway with a writable disposable migrator"
assert_success "$GW" up local
it "writes the owner-only protection store"
assert_success test -f "$PORTTA_ROOT/state/auth/protections.json"
assert_eq "600" "$(test_file_mode "$PORTTA_ROOT/state/auth/protections.json")"
it "keeps the persistent authentication service read-only"
auth_container=$(test_gateway_container auth)
assert_eq "true false" "$(docker inspect "$auth_container" --format '{{.HostConfig.ReadonlyRootfs}} {{range .Mounts}}{{if eq .Destination "/app/state/auth"}}{{.RW}}{{end}}{{end}}')"

up_demo demo-a &
up_demo demo-b &
wait

describe "baseline"
it "demo-a is routed"; assert_success wait_for_route http://demo-a-web.localhost/ 200
it "doctor passes with two projects on the gateway"; assert_success "$GW" doctor

describe "restarting the gateway"
"$GW" restart >/dev/null 2>&1
it "the application container was not restarted"
assert_eq "running" "$(test_container_state demo-a-web-1)"
it "routes come back on their own"; assert_success wait_for_route http://demo-a-web.localhost/ 200

describe "stopping the gateway"
"$GW" down >/dev/null 2>&1
it "applications keep running"; assert_eq "running" "$(test_container_state demo-a-web-1)"
it "the private network survives"; assert_success test_network_exists demo-a_default
it "the shared network is NOT removed"; assert_success test_network_exists "$PORTTA_NETWORK"
it "consumer volumes survive"
assert_success sh -c "docker volume ls --format '{{.Name}}' | grep -q '^demo-a_pgdata$'"

describe "starting the gateway again"
"$GW" up local >/dev/null 2>&1
it "existing applications are rediscovered"; assert_success wait_for_route http://demo-a-web.localhost/ 200
it "so is the second project"; assert_success wait_for_route http://demo-b-web.localhost/ 200

describe "stopping one project does not disturb the other"
down_demo demo-a
it "demo-b is still served"; assert_eq "200" "$(test_http_code http://demo-b-web.localhost/)"
it "the gateway is still healthy"; assert_success wait_for_health "$(test_gateway_container traefik)"
it "demo-a's route is gone"; assert_ne "200" "$(test_http_code http://demo-a-web.localhost/)"

t_summary
