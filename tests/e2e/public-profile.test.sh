#!/usr/bin/env bash
# ============================================================================
# E2E: the public profile
# ============================================================================
# On a public host every routed service passes through ForwardAuth, and the
# registry decides per hostname: a credential, everybody, or nobody. This suite
# adopts a project on the remote-public profile and proves the three outcomes,
# that changing one needs no recreate, and that nothing is published on the host.
#
# It runs only on the disposable daemon. DNS is replaced by curl --resolve, and
# TLS is off: certificates and ACME are covered by the unit tests and by the
# operator's own first deploy, which this suite cannot do.
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
test_have git || { echo "git unavailable: E2E incomplete"; exit 1; }

DOMAIN="public.test"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/portta-public.XXXXXX")
PROJ="$WORK/shop"
TREE="$WORK/shop-feature"
STORE="$PORTTA_ROOT/state/auth/protections.json"
jq_py() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

down_project() {
  [ -d "$1" ] && "$GW" runtime down "$1" >/dev/null 2>&1
  return 0
}
cleanup() {
  down_project "$PROJ"; down_project "$TREE"
  docker volume rm shop_dbdata >/dev/null 2>&1
  [ -n "${name2:-}" ] && docker volume rm "${name2}_dbdata" >/dev/null 2>&1
  for key in PORTTA_PROFILE PUBLIC_ENABLED PUBLIC_DOMAIN PORTTA_TCP PORTTA_WEB_EXPOSE TLS_ENABLED; do
    test_env_set "$key" "" >/dev/null 2>&1
  done
  test_env_set PORTTA_PROFILE local >/dev/null 2>&1
  "$GW" up local >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# curl against a hostname the gateway routes, with no DNS involved.
host_of() { printf '%s--%s.%s' "$1" "$2" "$DOMAIN"; }
http_code() { # http_code <host> [curl options...]
  local host="$1"; shift
  curl -s -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:80:127.0.0.1" "$@" "http://$host/"
}
page() { # page <host> [curl options...]
  local host="$1"; shift
  curl -s --max-time 10 --resolve "$host:80:127.0.0.1" "$@" "http://$host/"
}
is_code() { [ "$(http_code "$@")" = "$EXPECT" ]; }
wait_code() { # wait_code <expected> <host> [curl options...]
  EXPECT="$1"; shift
  test_wait_until 40 is_code "$@"
}
NAV=(-H 'Accept: text/html' -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Dest: document')

# ---------------------------------------------------------------------------
# A project that publishes host ports, with a database
# ---------------------------------------------------------------------------
mkdir -p "$PROJ"
cat > "$PROJ/compose.yaml" <<'YAML'
services:
  web:
    image: traefik/whoami:v1.12.0
    command: ["--port", "3000", "--name", "shop-web"]
    ports:
      - "8080:3000"
  api:
    image: traefik/whoami:v1.12.0
    command: ["--port", "4000", "--name", "shop-api"]
    ports:
      - "8081:4000"
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
volumes:
  dbdata:
YAML
( cd "$PROJ" && git init -q -b main && git add . && git -c user.name=t -c user.email=t@t commit -qm init )

test_env_set PUBLIC_ENABLED true
test_env_set PUBLIC_DOMAIN "$DOMAIN"
test_env_set TLS_ENABLED false
test_env_set PORTTA_PROFILE remote-public

describe "the public profile starts"
it "the gateway comes up on the remote-public profile"
assert_success "$GW" up remote-public
it "ForwardAuth is running, because everything routed depends on it"
assert_eq "running" "$(test_container_state "$(test_gateway_container auth)")"

describe "adopt asks who may open each service"
plan=$("$GW" adopt "$PROJ" --dry-run --json 2>/dev/null)
it "a missing decision is a pending public_exposure"
assert_contains "$plan" "public_exposure"
it "the outcome is not_supported"
assert_eq "not_supported" "$(printf '%s' "$plan" | jq_py "d['data']['outcome']")"
it "adopt refuses to continue without a decision"
assert_failure "$GW" adopt "$PROJ" --service web:3000 --service api:4000
it "no decision was written to the registry"
assert_eq "0" "$(python3 -c "import json;print(len(json.load(open('$STORE'))['protections']))")"

describe "adopt records the decision and the credentials come back once"
result=$("$GW" adopt "$PROJ" --project shop --service web:3000 --service api:4000 --protect web --public api --json 2>/dev/null)
password=$(printf '%s' "$result" | jq_py "d['data']['credentials'][0]['password']")
it "a credential for web is returned"
assert_ne "" "$password"
it "the plan on disk never holds the password"
assert_eq "0" "$(grep -rFl -- "$password" "$PORTTA_ROOT/runtime" 2>/dev/null | wc -l | tr -d ' ')"
it "the registry holds a hash, not the password"
assert_eq "0" "$(grep -Fc -- "$password" "$STORE")"
it "the registry file is owner-only"
assert_eq "600" "$(test_file_mode "$STORE")"
it "rerunning adopt without flags does not ask again"
assert_success "$GW" adopt "$PROJ" --service web:3000 --service api:4000

describe "the project runs behind the gateway"
assert_success "$GW" runtime up "$PROJ"
WEB=$(host_of shop web); API=$(host_of shop api)
it "the protected service answers its login redirect"
assert_success wait_code 302 "$WEB" "${NAV[@]}"
it "without a browser's headers it is a plain 401"
assert_eq "401" "$(http_code "$WEB")"
it "a wrong password is refused"
assert_eq "401" "$(curl -s -o /dev/null -w '%{http_code}' --resolve "$WEB:80:127.0.0.1" -X POST -H "Origin: http://$WEB" -d 'user=reviewer&password=nope&next=/' "http://$WEB/__portta/auth/login")"
JAR="$WORK/jar"
it "the right password logs in"
assert_eq "303" "$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" --resolve "$WEB:80:127.0.0.1" -X POST -H "Origin: http://$WEB" --data-urlencode "user=reviewer" --data-urlencode "password=$password" -d 'next=/' "http://$WEB/__portta/auth/login")"
it "and the session reaches the application"
assert_contains "$(page "$WEB" -b "$JAR")" "shop-web"
it "the public service opens with no login"
assert_success wait_code 200 "$API"
assert_contains "$(page "$API")" "shop-api"
it "the previous generated hostname has no route"
assert_eq "404" "$(http_code "shop-api.$DOMAIN")"
it "a hostname nobody decided about is closed"
assert_ne "200" "$(http_code "$(host_of shop ghost)")"

describe "changing a decision needs no recreate"
before=$(docker inspect shop-web-1 --format '{{.State.StartedAt}}' 2>/dev/null)
"$GW" protect open "$WEB" >/dev/null 2>&1
it "protect open opens the host at once"
assert_success wait_code 200 "$WEB"
it "the container was not recreated"
assert_eq "$before" "$(docker inspect shop-web-1 --format '{{.State.StartedAt}}' 2>/dev/null)"
"$GW" protect remove "$WEB" >/dev/null 2>&1
it "protect remove closes it again"
assert_success wait_code 401 "$WEB"
it "runtime up does not ask for the decision again"
assert_success "$GW" runtime up "$PROJ"

describe "isolation"
it "docker ps shows no published port for the project"
assert_eq "" "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^shop-' | grep -E '0\.0\.0\.0|127\.0\.0\.1|:::' || true)"
it "the database is not routed"
assert_ne "200" "$(http_code "$(host_of shop db)")"
it "another container on the gateway network cannot reach the database"
assert_failure docker run --rm --network "$PORTTA_NETWORK" "$(docker inspect shop-db-1 --format '{{.Config.Image}}')" pg_isready -h shop-db-1 -p 5432 -t 3
it "TCP routing is refused on the public profile"
test_env_set PORTTA_TCP true
assert_failure "$GW" public enable --yes
test_env_set PORTTA_TCP false

describe "going private and back keeps decisions and plans"
"$GW" public disable >/dev/null 2>&1
it "the registry survives"
assert_success test -s "$STORE"
it "the plan survives"
assert_success sh -c "ls '$PORTTA_ROOT'/runtime/compose/*/plan.json"
"$GW" public enable --yes >/dev/null 2>&1
it "the public decision still applies afterwards"
assert_success wait_code 200 "$API"

describe "two worktrees of one project do not collide"
( cd "$PROJ" && git worktree add -q -b feature "$TREE" )
plan2=$("$GW" adopt "$TREE" --service web:3000 --service api:4000 --protect web --public api --json 2>/dev/null)
it "the second worktree has its own project name and hostnames"
name2=$(printf '%s' "$plan2" | jq_py "d['data']['compose']['projectName']")
assert_ne "shop" "$name2"
it "its hostnames differ from the first"
assert_ne "$WEB" "$(printf '%s' "$plan2" | jq_py "d['data']['services'][0]['host']")"
it "both run side by side"
assert_success "$GW" runtime up "$TREE"
it "each has its own volume"
assert_eq "2" "$(docker volume ls --format '{{.Name}}' | grep -c '_dbdata$')"

t_summary
