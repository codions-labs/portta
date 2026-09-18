#!/usr/bin/env bash
# ============================================================================
# E2E: two databases on one host port, told apart by hostname
# ============================================================================
# The claim this suite exists to keep honest: two PostgreSQL instances, both
# listening on 5432 inside their own containers, neither publishing a host
# port, both reachable through the SAME host port, with the hostname deciding
# which one answers.
#
# One instance would prove nothing here. It would pass with the routing removed
# entirely, because there would be nothing to route wrongly. So every check
# uses two, with different data in each, and asserts which one answered.
#
# See docs/product/guides/tcp-routing.md for why PostgreSQL and Redis can do this and MySQL
# cannot.
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

# Ports well away from anything the host is likely to be using: this suite is
# about the mechanism, not about owning 5432 on somebody's machine.
PG_PORT=15432
REDIS_PORT=16379
A=tcproute-a
B=tcproute-b

# Installation values intentionally win over inherited shell variables. Keep
# the three original values and exercise the same persistent configuration the
# CLI and Compose use, then put it back during cleanup.
ORIGINAL_TCP="$PORTTA_TCP"
ORIGINAL_PG_PORT="$PORTTA_TCP_POSTGRES_PORT"
ORIGINAL_REDIS_PORT="$PORTTA_TCP_REDIS_PORT"
test_env_set PORTTA_TCP true >/dev/null
test_env_set PORTTA_TCP_POSTGRES_PORT "$PG_PORT" >/dev/null
test_env_set PORTTA_TCP_REDIS_PORT "$REDIS_PORT" >/dev/null

compose_env() {
  ( cd "$(test_example_dir demo-a)" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml -f compose.portta-tcp.yaml "${@:2}" )
}

cleanup() {
  test_toolbox_stop
  compose_env "$A" down -v >/dev/null 2>&1 &
  compose_env "$B" down -v >/dev/null 2>&1 &
  wait
  test_env_set PORTTA_TCP "$ORIGINAL_TCP" >/dev/null 2>&1
  test_env_set PORTTA_TCP_POSTGRES_PORT "$ORIGINAL_PG_PORT" >/dev/null 2>&1
  test_env_set PORTTA_TCP_REDIS_PORT "$ORIGINAL_REDIS_PORT" >/dev/null 2>&1
  "$GW" up "$PORTTA_PROFILE" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

# psql_at <hostname> <sslmode>: run a query through the gateway and print the
# single value, or the error. A refused connection is not always closed: without
# SNI Traefik waits for an HTTP request that never comes, so bound the attempt.
psql_at() {
  docker exec "$PORTTA_TOOLBOX" \
    psql "postgresql://demo:demo@$1:$PG_PORT/demo?sslmode=$2&connect_timeout=5" -tAc "select name from whoami" 2>&1 | head -1
}

redis_at() {
  docker exec "$PORTTA_TOOLBOX" \
    redis-cli -h 127.0.0.1 -p "$REDIS_PORT" --tls --sni "$1" --insecure get whoami 2>&1 | head -1
}

# answered_by <output> <marker>: did that database answer? A substring check
# would be wrong here, because psql prints the hostname inside its error text
# and the hostname contains the project name.
answered_by() { [ "$1" = "$2" ]; }
refused() { [ "$1" != "$2" ]; }

psql_require() { psql_at "$1" require; }

# wait_for <probe> <hostname> <expected>: Traefik learns about a container from
# Docker events, which is fast but not instant. Each protocol gets its own
# router, and they do not necessarily go live together, so waiting on the
# PostgreSQL one says nothing about Redis.
#
# Until a router matches, Traefik answers the connection over HTTP rather than
# closing it, so the failure looks like a protocol error rather than a timeout.
answers() { [ "$("$1" "$2")" = "$3" ]; }
wait_for() { test_wait_until 30 answers "$@"; }

describe "the gateway publishes one port per protocol"

"$GW" up "$PORTTA_PROFILE" >/dev/null 2>&1
# Docker's resolver does not promise RFC 6761 wildcard localhost names. Keep the
# hostnames in the URLs for TLS SNI, but resolve them explicitly in the client.
test_toolbox_start \
  --add-host "$A-postgres.$PORTTA_DOMAIN:127.0.0.1" \
  --add-host "$B-postgres.$PORTTA_DOMAIN:127.0.0.1" \
  --add-host "nobody-postgres.$PORTTA_DOMAIN:127.0.0.1" \
  || { echo "toolbox unavailable: E2E incomplete"; exit 1; }
traefik_ports=$(docker ps --format '{{.Names}} {{.Ports}}' | grep 'portta-traefik' || true)

it "PostgreSQL has an entrypoint"
assert_contains "$traefik_ports" ":$PG_PORT->5432"

it "Redis has one too"
assert_contains "$traefik_ports" ":$REDIS_PORT->6379"

describe "two projects, same internal ports, no published ports"

compose_env "$A" up -d --wait --wait-timeout 180 >/dev/null 2>&1 &
compose_env "$B" up -d --wait --wait-timeout 180 >/dev/null 2>&1 &
wait
docker exec "$A-postgres-1" psql -U demo -d demo -qc \
  "create table whoami(name text); insert into whoami values ('$A');" >/dev/null 2>&1
docker exec "$B-postgres-1" psql -U demo -d demo -qc \
  "create table whoami(name text); insert into whoami values ('$B');" >/dev/null 2>&1
docker exec "$A-redis-1" redis-cli set whoami "$A" >/dev/null 2>&1
docker exec "$B-redis-1" redis-cli set whoami "$B" >/dev/null 2>&1

it "neither database publishes a host port"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' \
  | grep -E "^($A|$B)-(postgres|redis)-1 " | grep -E '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:' || true)"

container_ports() {
  docker inspect "$1" --format '{{ range $p, $v := .Config.ExposedPorts }}{{ $p }} {{ end }}' 2>/dev/null \
    | tr ' ' '\n' | sed -n 's#^\([0-9]\{1,5\}\)/tcp$#\1#p' | sort -n -u
}

it "both still listen on the standard port inside their own container"
assert_eq "5432
5432" "$(container_ports "$A-postgres-1"; container_ports "$B-postgres-1")"

it "neither joined the shared HTTP network"
assert_eq "" "$(docker inspect "$A-postgres-1" "$B-postgres-1" \
  --format '{{ range $k, $v := .NetworkSettings.Networks }}{{ $k }} {{ end }}' \
  | tr ' ' '\n' | grep -x "$PORTTA_NETWORK" || true)"

describe "the hostname decides which database answers"

it "the first project's data comes back on its own hostname"
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "and the second's on its own, through the very same port"
assert_success wait_for psql_require "$B-postgres.$PORTTA_DOMAIN" "$B"

it "they really are different databases, queried back to back"
assert_eq "$A|$B" "$(psql_at "$A-postgres.$PORTTA_DOMAIN" require)|$(psql_at "$B-postgres.$PORTTA_DOMAIN" require)"

# The Redis routers are separate from the PostgreSQL ones, so they need their
# own wait. Without it this asserts against whichever router happened to be
# live first, and fails on a loaded machine.
wait_for redis_at "$A-redis.$PORTTA_DOMAIN" "$A" || true
wait_for redis_at "$B-redis.$PORTTA_DOMAIN" "$B" || true

it "Redis does the same on its own single port"
assert_eq "$A|$B" "$(redis_at "$A-redis.$PORTTA_DOMAIN")|$(redis_at "$B-redis.$PORTTA_DOMAIN")"

describe "without TLS there is no hostname to route on"

it "sslmode=disable is refused rather than sent somewhere arbitrary"
assert_success refused "$(psql_at "$A-postgres.$PORTTA_DOMAIN" disable)" "$A"

it "and connecting by IP is too, because SNI is never sent for one"
assert_success refused "$(psql_at "127.0.0.1" require)" "$A"

it "an unknown hostname reaches nothing"
assert_success refused "$(psql_at "nobody-postgres.$PORTTA_DOMAIN" require)" "$A"

it "and gets Traefik's HTTP 404, because an unmatched TCP entrypoint falls back to HTTP"
assert_contains "$(redis_at "nobody-redis.$PORTTA_DOMAIN")" "Protocol error"

describe "routes follow the containers"

it "stopping one leaves the other alone"
docker stop "$A-postgres-1" >/dev/null 2>&1
assert_eq "$B" "$(psql_at "$B-postgres.$PORTTA_DOMAIN" require)"

it "and the stopped one stops answering"
stopped_answers_nothing() { refused "$(psql_at "$A-postgres.$PORTTA_DOMAIN" require)" "$A"; }
assert_success test_wait_until 15 stopped_answers_nothing

it "starting it again brings its route back"
docker start "$A-postgres-1" >/dev/null 2>&1
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

it "recreating it from scratch works too"
compose_env "$A" up -d --force-recreate --wait --wait-timeout 180 postgres >/dev/null 2>&1
docker exec "$A-postgres-1" psql -U demo -d demo -qc \
  "create table if not exists whoami(name text); delete from whoami; insert into whoami values ('$A');" >/dev/null 2>&1
assert_success wait_for psql_require "$A-postgres.$PORTTA_DOMAIN" "$A"

t_summary
