#!/usr/bin/env bash
# ============================================================================
# E2E: adopting an unknown project
# ============================================================================
# The acceptance test for the whole adoption story: build a project the gateway
# has never seen, one that looks like the awkward real thing: a built image, a
# worker sharing that image, a database, and host ports that collide with
# what is already running: then adopt it without changing its Compose input.
#
# It proves that the adopted project runs on the gateway without editing its
# source Compose file. The dry-run plan is covered by the CLI's own tests, and
# parallel copies of one project by tcp-access.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime

GW="$PORTTA_ROOT/bin/portta"
test_require_docker || { echo "Docker unavailable: E2E incomplete"; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/portta-adopt.XXXXXX")
PROJ="$WORK/external-shop"
SOURCE="$WORK/compose-source.yaml"

cleanup() {
  ( cd "$PROJ" 2>/dev/null && docker compose -p "$(basename "$PROJ")" \
      -f compose.yaml down -v ) >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# A project the gateway has never seen
# ---------------------------------------------------------------------------
mkdir -p "$PROJ"
cat > "$PROJ/Dockerfile" <<'DOCKER'
FROM traefik/whoami:v1.12.0
DOCKER

cat > "$PROJ/compose.yaml" <<'YAML'
# Deliberately awkward: a built image (so the analyzer cannot classify by image
# name), a worker sharing it, a fixed container name, and host ports on 80 and
# 5432 that a second copy could never bind.
services:
  storefront:
    build: .
    command: ["--port", "3000", "--name", "external-storefront"]
    container_name: external-shop-storefront
    ports:
      - "80:3000"

  worker:
    build: .
    command: ["--port", "3000", "--name", "external-worker"]

  db:
    image: postgres:18.6-alpine
    environment:
      POSTGRES_USER: shop
      POSTGRES_PASSWORD: shop
      POSTGRES_DB: shop
    ports:
      - "5432:5432"
    volumes:
      - dbdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -h 127.0.0.1 -U shop -d shop"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 30s
      start_interval: 1s

volumes:
  dbdata:
YAML

cp "$PROJ/compose.yaml" "$SOURCE"
"$GW" up local >/dev/null 2>&1

describe "adopt stores the validated runtime plan outside the source project"
it "records the explicit compatibility decision"
assert_success "$GW" adopt "$PROJ" --remove-container-name storefront
it "reuses the plan to print the effective Compose model"
assert_success "$GW" runtime config "$PROJ"
it "still does not create a project overlay"; assert_failure test -f "$PROJ/compose.portta.yaml"
it "keeps compose.yaml byte-for-byte unchanged"; assert_success cmp -s "$SOURCE" "$PROJ/compose.yaml"

describe "the adopted project runs"
it "starts from the stored plan"; assert_success "$GW" runtime up "$PROJ"

it "the storefront is routed"
assert_success test_wait_until 30 test_route_is "http://external-shop-storefront.$PORTTA_DOMAIN/" 200
it "it is the right application"
assert_contains "$(curl -s --max-time 10 \
  --resolve "external-shop-storefront.$PORTTA_DOMAIN:${PORTTA_HTTP_PORT}:${PORTTA_BIND_ADDRESS}" \
  "http://external-shop-storefront.$PORTTA_DOMAIN/")" "external-storefront"
it "the worker is not routed"
assert_ne "200" "$(test_http_code "http://external-shop-worker.$PORTTA_DOMAIN/")"
it "the database is not routed"
assert_ne "200" "$(test_http_code "http://external-shop-db.$PORTTA_DOMAIN/")"
it "nothing is published on the host"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^external-shop' | grep -E '0\.0\.0\.0|127\.0\.0\.1' || true)"

t_summary
