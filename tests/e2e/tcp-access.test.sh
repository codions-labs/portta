#!/usr/bin/env bash
# ============================================================================
# E2E: several environments at once, on the same internal ports, all reachable
# ============================================================================
# The gateway's central claim, tested end to end:
#
#   demo-a, demo-b, demo-a-issue-1 and demo-a-issue-2 all run Postgres on 5432
#   and Redis on 6379 simultaneously (the first three also web:3000 and
#   api:8000), with no host port published by any of them.
#
# Every web and api is routed under its own hostname, every database is
# reachable from the host at the same time on its own loopback port, and a real
# query proves each bridge reaches a genuinely different database.
#
# Requires Docker and a running gateway. Creates only its own fixtures and
# removes only what it created.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime

GW="$PORTTA_ROOT/bin/portta"
ENVS="demo-a demo-a-issue-1 demo-a-issue-2 demo-b"
# Environments whose HTTP services are started and routed. demo-a-issue-2 runs
# only its datastores: a third copy of the same web routing proves nothing new.
ROUTED="demo-a demo-a-issue-1 demo-b"
PROBE=portta-optin-probe
test_require_docker || { echo "Docker unavailable: E2E incomplete"; exit 1; }

compose_env() { # compose_env <namespace> <compose args...>
  local dir="demo-a"; [ "$1" = "demo-b" ] && dir="demo-b"
  ( cd "$(test_example_dir "$dir")" && COMPOSE_PROJECT_NAME="$1" docker compose \
      -f compose.yaml -f compose.portta.yaml "${@:2}" ) >/dev/null 2>&1
}
up_env() {
  case "$1" in
    demo-a-issue-2) compose_env "$1" up -d --wait --wait-timeout 180 postgres redis ;;
    *) compose_env "$1" up -d --wait --wait-timeout 180 ;;
  esac
}
down_env() { compose_env "$1" down -v; }

cleanup() {
  test_toolbox_stop
  docker rm -f "$PROBE" >/dev/null 2>&1
  "$GW" access close --all >/dev/null 2>&1
  "$GW" service unpublish --project demo-a >/dev/null 2>&1
  "$GW" service unpublish --project demo-b >/dev/null 2>&1
  for ns in $ENVS; do down_env "$ns" & done
  wait
}
trap cleanup EXIT INT TERM

# bridges <python expression over the bridge list b>: one read of `access list`.
bridges() {
  "$GW" access list --json 2>/dev/null | python3 -c "import json,sys; b=json.load(sys.stdin)['data']['bridges']; print($1)"
}

# pg <port> <sql>: a real query through the bridge.
pg() {
  docker exec -e PGPASSWORD=demo "$PORTTA_TOOLBOX" \
    psql "postgresql://demo@127.0.0.1:$1/demo" -tAc "$2" 2>&1 | tr -d ' \n'
}
redis() { docker exec "$PORTTA_TOOLBOX" redis-cli -h 127.0.0.1 -p "$@" 2>&1; }

"$GW" up local >/dev/null 2>&1
test_toolbox_start || { echo "toolbox unavailable: E2E incomplete"; exit 1; }

# A container on the shared network with no traefik.enable=true must stay
# invisible: exposedByDefault=false is the difference between a gateway and an
# accident. It starts before the environments, so once their routes are live
# Traefik has certainly processed it too, and its absence means something.
docker run -d --rm --name "$PROBE" --network "$PORTTA_NETWORK" \
  --label com.docker.compose.project=optin-probe \
  --label com.docker.compose.service=web \
  traefik/whoami:v1.12.0 --port 3000 >/dev/null 2>&1

describe "four environments, all on the standard ports"
declare -A STARTED
for ns in $ENVS; do up_env "$ns" & STARTED[$ns]=$!; done
for ns in $ENVS; do
  it "$ns starts"; if wait "${STARTED[$ns]}"; then _t_pass; else _t_fail "compose up failed"; fi
done
it "none publishes a host port"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep -E '^(demo-a|demo-b)' | grep -E '0\.0\.0\.0|127\.0\.0\.1' || true)"

describe "every web and api is routed under its own hostname"
for ns in $ROUTED; do
  it "$ns web answers"; assert_success test_wait_until 30 test_route_is "http://${ns}-web.localhost/" 200
  it "$ns api answers"; assert_success test_wait_until 30 test_route_is "http://${ns}-api.localhost/" 200
done

urls=$("$GW" urls 2>/dev/null)
for ns in $ROUTED; do
  it "urls lists ${ns}-web"; assert_contains "$urls" "${ns}-web.localhost"
done

describe "nothing is routed without opting in"
it "a container without traefik.enable is not routed"
assert_ne "200" "$(test_http_code "http://optin-probe-web.$PORTTA_DOMAIN/")"
it "and urls does not list it"
assert_not_contains "$urls" "optin-probe"
docker rm -f "$PROBE" >/dev/null 2>&1

describe "each environment owns its own state"
it "internal ports were not renamed to dodge collisions"
assert_eq "5432 PONG" "$(docker exec demo-a-postgres-1 psql -U demo -d demo -tAc 'show port' 2>&1 | tr -d ' \n') $(docker exec demo-a-redis-1 redis-cli -p 6379 ping 2>&1)"
it "one private network per namespace"
assert_eq "4" "$(docker network ls --format '{{.Name}}' | grep -cE '^(demo-a|demo-a-issue-1|demo-a-issue-2|demo-b)_default$')"
it "one postgres volume per namespace"
assert_eq "4" "$(docker volume ls --format '{{.Name}}' | grep -cE '^(demo-a|demo-a-issue-1|demo-a-issue-2|demo-b)_pgdata$')"
it "demo-b cannot reach demo-a's postgres"
assert_failure docker run --rm --network demo-b_default alpine:3.24.1 nc -z -w2 demo-a-postgres-1 5432
it "demo-b can reach its own postgres"
assert_success docker run --rm --network demo-b_default alpine:3.24.1 nc -z -w2 postgres 5432
shared=$(docker network inspect "$PORTTA_NETWORK" --format '{{ range .Containers }}{{ .Name }} {{ end }}' 2>/dev/null)
it "no datastore joined the shared HTTP network"
assert_eq "" "$(printf '%s' "$shared" | tr ' ' '\n' | grep -E 'postgres|redis' || true)"

describe "opening a bridge per database"
for ns in $ENVS; do
  it "$ns postgres"; assert_success "$GW" access open --project "$ns" --service postgres --quiet
  it "$ns redis";    assert_success "$GW" access open --project "$ns" --service redis --quiet
done

# One read of the bridge list serves every check until something is closed.
declare -A PORT
while read -r project service port; do PORT["$project/$service"]=$port; done \
  < <(bridges "'\n'.join(f\"{x['project']} {x['service']} {x['local_port']}\" for x in b)")

it "eight bridges are open"
assert_eq "8" "${#PORT[@]}"

it "every bridge got a different local port"
assert_eq "8" "$(printf '%s\n' "${PORT[@]}" | sort -u | grep -c .)"

it "every bridge binds loopback only"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^portta-access-' | grep -E '0\.0\.0\.0' || true)"

describe "each bridge reaches a different database"
for ns in $ENVS; do
  p=${PORT["$ns/postgres"]}
  it "$ns accepts a real query on 127.0.0.1:$p"
  assert_contains "$(pg "$p" "select 'ok'")" "ok"
  # Stamp each database with its own name, then read it back, so a
  # misdirected bridge cannot pass by accident.
  pg "$p" "create table if not exists whoami(id text); delete from whoami; insert into whoami values('$ns')" >/dev/null
  redis "${PORT["$ns/redis"]}" set owner "$ns" >/dev/null
done
for ns in $ENVS; do
  it "$ns's bridge still reaches $ns's own database"
  assert_eq "$ns" "$(pg "${PORT["$ns/postgres"]}" 'select id from whoami')"
  it "$ns's Redis bridge reaches $ns's own instance"
  assert_eq "$ns" "$(redis "${PORT["$ns/redis"]}" get owner)"
done

describe "closing one bridge does not disturb the others"
"$GW" access close --project demo-a >/dev/null 2>&1
it "demo-a's bridges are gone"
assert_eq "0" "$(bridges "sum(1 for x in b if x['project']=='demo-a')")"
it "demo-b's bridge still works"
assert_eq "demo-b" "$(pg "${PORT[demo-b/postgres]}" 'select id from whoami')"
it "and demo-a's database is still running"
assert_eq "running" "$(test_container_state demo-a-postgres-1)"

describe "clients that publish nothing at all"
it "db psql runs inside the project's network"
assert_contains "$("$GW" db psql --project demo-b -- -tAc 'select id from whoami' 2>&1)" "demo-b"
it "redis cli too"
assert_contains "$("$GW" redis cli --project demo-b -- get owner 2>&1)" "demo-b"
it "no client container is left behind"
assert_eq "" "$(docker ps -a --no-trunc --filter "ancestor=$PORTTA_TOOLBOX_IMAGE" --format '{{.ID}}' | grep -v "^$PORTTA_TOOLBOX" || true)"

describe "garbage collection only touches what the gateway owns"
down_env demo-a-issue-2
it "gc removes the bridge whose target is gone"
assert_success "$GW" access gc
it "it is really gone, and other projects' bridges are not"
assert_eq "0 2" "$(bridges "str(sum(1 for x in b if x['project']=='demo-a-issue-2')) + ' ' + str(sum(1 for x in b if x['project']=='demo-b'))")"
it "other projects were untouched"
assert_eq "running" "$(test_container_state demo-b-postgres-1)"

describe "persistent private publishing"
it "publishes demo-b's postgres"
assert_success "$GW" service publish --private --project demo-b --service postgres
it "the forwarder joins the project network and the access network, not the shared HTTP one"
assert_eq "demo-b_default $PORTTA_ACCESS_NETWORK" \
  "$(docker inspect portta-forward-demo-b-postgres --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -v '^$' | sort | tr '\n' ' ' | sed 's/ $//')"
it "it is reachable by alias on the standard port"
assert_contains "$(docker run --rm --network "$PORTTA_ACCESS_NETWORK" -e PGPASSWORD=demo "$PORTTA_TOOLBOX_IMAGE" \
  psql "postgresql://demo@demo-b-postgres:5432/demo" -tAc 'select id from whoami' 2>&1)" "demo-b"
it "but project networks are still not merged"
assert_failure docker run --rm --network "$PORTTA_ACCESS_NETWORK" "$PORTTA_TOOLBOX_IMAGE" \
  nc -z -w2 postgres 5432
it "publishing a database publicly is refused"
assert_failure "$GW" service publish --public --project demo-b --service postgres

t_summary
