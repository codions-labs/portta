#!/usr/bin/env bash
# ============================================================================
# E2E: the web panel against a real Docker host
# ============================================================================
# The panel's own suites cover its logic against a fake Docker API. This one
# checks the part only a real host can prove: that it comes up through the CLI,
# classifies a real project correctly, tells gateway containers from external
# ones, creates a bridge the CLI then manages, and never publishes its socket
# proxy.
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

BASE="http://127.0.0.1:${PORTTA_WEB_PORT:-8081}"
WEB_WAS_ENABLED="$PORTTA_WEB"
STRAY="portta-web-e2e-stray"

cleanup() {
  panel_sql "DELETE FROM settings WHERE key = 'web-e2e-persistence';" >/dev/null 2>&1
  curl -s -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
  "$GW" access close --all >/dev/null 2>&1
  docker rm -f "$STRAY" >/dev/null 2>&1
  ( cd "$(test_example_dir demo-a)" && docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
  test_is_true "$WEB_WAS_ENABLED" || "$GW" web disable >/dev/null 2>&1
}
BRIDGE_ID=""
# The panel's database is a file on this host, not a container: every statement
# below runs against it directly (docs/development/adr/0037-sqlite-is-the-panel-database.md).
PANEL_DB="$PORTTA_ROOT/state/panel/portta.db"
# Read through Python's bundled sqlite3 rather than the `sqlite3` binary, which
# is not on a stock GitHub runner and is not a dependency this suite may add:
# the host needs Docker, Git and a shell, which is why `jq_py` below exists too.
# Rows print pipe-separated, the way the `sqlite3` CLI does, because that is
# what the assertions compare against.
panel_sql() {
  python3 - "$PANEL_DB" "$1" <<'PY'
import sqlite3, sys

database, statement = sys.argv[1], sys.argv[2]
connection = sqlite3.connect(database)
try:
    try:
        rows = connection.execute(statement).fetchall()
    except (sqlite3.Warning, sqlite3.ProgrammingError) as refusal:
        # `execute` takes one statement and the fixtures below send several.
        # Which exception says so changed in 3.12, hence both; anything else
        # is a real error and has to keep propagating.
        if 'one statement at a time' not in str(refusal):
            raise
        connection.executescript(statement)
        rows = []
    connection.commit()
finally:
    connection.close()

for row in rows:
    print('|'.join('' if value is None else str(value) for value in row))
PY
}
trap cleanup EXIT INT TERM

# get <path>: the panel's JSON, or nothing.
get() { curl -fsS -m 10 "$BASE$1" 2>/dev/null; }

# jq_py <expression>: read stdin as JSON and print one value, with no jq
# dependency (the host only needs Docker, Git and a shell).
jq_py() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

describe "the panel starts through the CLI"

( cd "$(test_example_dir demo-a)" && docker compose \
    -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1

# A container that belongs to nobody: exactly what the Docker page exists for.
docker run -d --name "$STRAY" --label portta.e2e=true alpine:3.24.1 sleep 600 >/dev/null 2>&1

# Kept, not discarded: when `web up` fails, its own output is the only thing
# that says why, and every assertion below then fails for a reason none of them
# can explain.
WEB_UP_LOG=$(mktemp "${TMPDIR:-/tmp}/portta-web-up.XXXXXX")
"$GW" web up >"$WEB_UP_LOG" 2>&1 || true
if ! get /api/health >/dev/null 2>&1; then
  printf '\n--- web up said ---\n%s\n--- end ---\n\n' "$(cat "$WEB_UP_LOG")" >&2
  docker ps -a --filter 'label=portta.managed=true' --format '{{.Names}} {{.Status}}' >&2
  docker logs "$(test_gateway_container web)" 2>&1 | tail -20 >&2 || true
fi
rm -f "$WEB_UP_LOG"

it "answers as soon as 'web up' returns"
# `web up` waits for the healthcheck, so a successful return guarantees that
# callers can use the reported URL immediately.
assert_success get /api/health

describe "its database is a file it owns, migrated at boot"

# Drizzle keeps its own ledger (`drizzle_migrations`, one row per applied file)
# and the panel applies whatever the image carries at boot. Counting the files
# rather than naming the newest keeps this from being edited on every migration.
MIGRATION_COUNT=$(find "$PORTTA_ROOT/packages/db/drizzle" -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')

it "the panel created its database under state/panel"
assert_success test_wait_until 30 sh -c "[ -f '$PANEL_DB' ]"

it "every migration the image carries is recorded"
assert_eq "$MIGRATION_COUNT" "$(panel_sql 'SELECT count(*) FROM drizzle_migrations')"

# WAL is a property of the file, so this connection sees what the panel's
# connection set. `foreign_keys` is deliberately NOT asserted here: it is
# per-connection, so reading it from this shell would say nothing about the
# panel's — packages/db/tests/migrate.test.ts asserts it on a connection the
# panel's own code opened.
it "the panel left the database in WAL"
assert_eq "wal" "$(panel_sql 'PRAGMA journal_mode;')"

# What a first boot must leave behind, and nothing else creates: ssh_keys
# references it, so an installation without it cannot hold a credential.
it "the installation has its identity row"
assert_eq "1" "$(panel_sql 'SELECT count(*) FROM instance')"

it "no container publishes the database, because there is no database container"
assert_eq "" "$(docker ps --filter 'label=portta.component=db' --format '{{.Names}}')"

panel_sql "DELETE FROM settings WHERE key = 'web-e2e-persistence';
           INSERT INTO settings (key, value) VALUES ('web-e2e-persistence', '\"true\"');"

describe "it describes the host the way the CLI does"

status=$(get /api/status)

it "sees the gateway as up"
assert_eq "True" "$(printf '%s' "$status" | jq_py "d['gateway']['up']")"

it "agrees with the CLI about the profile"
assert_eq "$PORTTA_PROFILE" "$(printf '%s' "$status" | jq_py "d['gateway']['profile']")"

it "counts the same routes as portta urls"
assert_eq "$("$GW" urls --json 2>/dev/null | jq_py "len(d['data']['routes'])")" \
  "$(printf '%s' "$status" | jq_py "d['counts']['routes']")"

it "lists demo-a as an integrated environment"
assert_contains "$(get /api/environments | jq_py "[e['name'] for e in d['environments'] if e['integrated']]")" "demo-a"

it "groups the environment's database under it, though it never joined the gateway"
assert_contains \
  "$(get /api/environments/demo-a | jq_py "[s['service'] for s in d['services']]")" "postgres"

it "shows the URL Traefik actually serves"
assert_contains "$(get /api/environments/demo-a | jq_py "[u['host'] for u in d['urls']]")" \
  "demo-a-web.$PORTTA_DOMAIN"

describe "it tells the gateway's containers from everybody else's"

containers=$(get /api/docker/containers)
owner_of() {
  printf '%s' "$containers" | python3 -c "
import json,sys
for c in json.load(sys.stdin)['containers']:
    if c['name'] == '$1': print(c['ownership']); break"
}

it "the gateway's own containers are marked as its own"
assert_eq "gateway" "$(owner_of portta-traefik-1)"

it "the panel itself is gateway-owned too"
assert_eq "gateway" "$(owner_of portta-web-1)"

it "an adopted project's service is integrated"
assert_eq "integrated" "$(owner_of demo-a-web-1)"

it "a container started by hand is standalone"
assert_eq "standalone" "$(owner_of "$STRAY")"

describe "it says what mode it is in, and the CLI agrees"

# The panel is what stands in front of the panel now, so `.env` and the running
# process have to agree about whether it signs people in. This host is on
# loopback, which is the one place `disabled` is legal.
it "reports open mode with nothing to set up, as web status reads it from .env"
assert_eq "open False disabled" "$(get /api/auth/status | jq_py "d['mode'], d['setupRequired']" | tr -d "()',") $("$GW" web status --json | jq_py "d['data']['authMode']")"

describe "it refuses what it must refuse"

it "will not stop a gateway component"
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST \
  "$BASE/api/docker/containers/portta-traefik-1/stop")
assert_eq "403" "$code"

it "and the component is still running"
assert_eq "running" "$(test_container_state portta-traefik-1)"

describe "a bridge opened in the panel is a bridge the CLI manages"

BRIDGE_ID=$(curl -fsS -m 30 -X POST -H 'content-type: application/json' \
  -d '{"project":"demo-a","service":"postgres"}' "$BASE/api/access" 2>/dev/null \
  | jq_py "d['bridge']['id']" 2>/dev/null)

it "the panel opened one"
assert_not_contains "x$BRIDGE_ID" "xNone"

it "portta access list sees it"
assert_contains "$("$GW" access list --json 2>/dev/null)" "\"id\": \"$BRIDGE_ID\""

it "it binds loopback, like every other bridge"
assert_not_contains "$(docker ps --format '{{.Names}} {{.Ports}}' | grep '^portta-access-')" "0.0.0.0"

it "closing it in the panel removes the container"
curl -fsS -m 10 -X DELETE "$BASE/api/access/$BRIDGE_ID" >/dev/null 2>&1
test_wait_until 10 sh -c '[ -z "$(docker ps -q --filter "label=portta.access.id='"$BRIDGE_ID"'")" ]'
assert_eq "" "$(docker ps -q --filter "label=portta.access.id=$BRIDGE_ID")"
BRIDGE_ID=""

it "and the database it bridged to is untouched"
assert_eq "running" "$(test_container_state demo-a-postgres-1)"

describe "the panel's socket proxy is unreachable"

it "it publishes no host port"
assert_eq "" "$(docker inspect portta-web-socket-proxy-1 \
  --format '{{ range $p, $c := .NetworkSettings.Ports }}{{ range $c }}{{ .HostIp }}:{{ .HostPort }} {{ end }}{{ end }}' 2>/dev/null)"

it "its network is internal"
assert_eq "true" "$(docker network inspect "${PORTTA_WEB_NETWORK:-portta-web}" \
  --format '{{ .Internal }}' 2>/dev/null)"

describe "stopping the panel leaves everything else alone"

"$GW" web down >/dev/null 2>&1

it "the panel is gone"
# The daemon settles a removal asynchronously, so poll rather than sleeping a
# second and hoping that was enough.
test_wait_until 30 sh -c '[ -z "$(docker ps -q --filter label=portta.component=web)" ]'
assert_eq "" "$(docker ps -q --filter 'label=portta.component=web')"

it "Traefik is still running"
assert_eq "running" "$(test_container_state portta-traefik-1)"

it "so is the project"
assert_eq "running" "$(test_container_state demo-a-web-1)"

describe "the database file survives a complete panel down/up"

"$GW" web up >/dev/null 2>&1
test_wait_until 60 sh -c 'curl -fsS -m 10 "'"$BASE"'/api/health" >/dev/null'

it "the persisted marker comes back"
assert_eq "1" "$(panel_sql "SELECT count(*) FROM settings WHERE key = 'web-e2e-persistence'")"

# The failure this guards: a bind mount of the .db file alone leaves the -wal
# inside the container, so a restart reads a database missing its most recent
# writes and re-applies nothing.
it "the migrations are still recorded exactly once"
assert_eq "$MIGRATION_COUNT" "$(panel_sql 'SELECT count(*) FROM drizzle_migrations')"

panel_sql "DELETE FROM settings WHERE key = 'web-e2e-persistence';"

t_summary
