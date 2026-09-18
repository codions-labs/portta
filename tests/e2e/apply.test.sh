#!/usr/bin/env bash
# ============================================================================
# E2E: applying settings without a terminal
# ============================================================================
# The panel writes .env and can only start containers, so a saved setting used
# to need `portta up` typed on the host. The applier closes that gap: a stopped,
# single-purpose container the panel may start.
#
# What has to be true for it to be safe, and to work at all:
#   - it does not exist unless PORTTA_APPLY=true;
#   - it recreates the gateway, so a static Traefik setting actually changes;
#   - it survives the `up --remove-orphans` it runs, or its exit code is lost;
#   - it never touches a consumer project.
#
# See docs/development/adr/0026-applying-settings-from-the-panel.md.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime

GW="$PORTTA_ROOT/bin/portta"
ORIGINAL_LOG_LEVEL="$PORTTA_LOG_LEVEL"
# Remember how apply was configured so the suite leaves the host as it found it.
# The last assertion turns the key off; without this, a checkout that had
# PORTTA_APPLY=true would keep the panel asking the operator to set a key they
# already had.
ORIGINAL_APPLY="$PORTTA_APPLY"
# The whole point of the apply is that a *changed* static setting reaches
# Traefik, so the target has to differ from what this host already has. Writing
# DEBUG unconditionally made the suite pass or fail on the developer's own .env:
# on a host already logging at DEBUG the `up` was a no-op, Traefik kept its
# container, and "because its container was replaced" failed while every other
# assertion passed.
if [ "$ORIGINAL_LOG_LEVEL" = "DEBUG" ]; then TARGET_LOG_LEVEL=INFO; else TARGET_LOG_LEVEL=DEBUG; fi

# Each `up` recreates or reconciles the gateway, so the suite converges three
# times: prepare, apply, turn off. Cleanup converges again only if the last one
# never ran.
RESTORED=0
cleanup() {
  test_env_set PORTTA_LOG_LEVEL "$ORIGINAL_LOG_LEVEL" >/dev/null 2>&1
  test_env_set PORTTA_APPLY "$ORIGINAL_APPLY" >/dev/null 2>&1
  [ "$RESTORED" = 1 ] || PORTTA_APPLY="$ORIGINAL_APPLY" "$GW" up local >/dev/null 2>&1
  ( cd "$(test_example_dir demo-a)" && docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

traefik_log_level() {
  docker inspect portta-traefik-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep '^TRAEFIK_LOG_LEVEL=' | cut -d= -f2
}

describe "turning it on prepares it, stopped"

test_env_set PORTTA_APPLY true >/dev/null
"$GW" up local >/dev/null 2>&1
APPLIER=$(test_gateway_container apply)

it "the container exists"
assert_ne "" "$APPLIER"

it "and has never been started"
assert_eq "created" "$(test_container_state "$APPLIER")"

it "it is not part of the gateway's Compose project"
# The reason it is not: `up --remove-orphans` decides what to delete from the
# project label, so a Compose applier would remove itself mid-run.
assert_eq "" "$(docker inspect "$APPLIER" \
  --format '{{ index .Config.Labels "com.docker.compose.project" }}' 2>/dev/null)"

it "the repository is mounted at the path the host knows it by"
# Compose hands the daemon absolute host paths for the overlays' relative binds
# (./config, ./state). A different path in here makes Docker create empty
# directories in their place, and Traefik starts with no dynamic configuration.
assert_contains "$(docker inspect "$APPLIER" --format '{{range .HostConfig.Binds}}{{println .}}{{end}}')" \
  "$PORTTA_ROOT:$PORTTA_ROOT"

it "and its working directory is that same path"
assert_eq "$PORTTA_ROOT" "$(docker inspect "$APPLIER" --format '{{.Config.WorkingDir}}')"

describe "it recreates the gateway, rather than restarting it"

# A restart would keep the environment the container was created with, which is
# exactly why the panel could not do this itself. Traefik's log level is a
# static setting: if it changed, the container was recreated.
( cd "$(test_example_dir demo-a)" && docker compose \
    -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 180 ) >/dev/null 2>&1
DEMO_BEFORE=$(docker inspect demo-a-web-1 --format '{{.Id}}' 2>/dev/null)
TRAEFIK_BEFORE=$(docker inspect portta-traefik-1 --format '{{.Id}}' 2>/dev/null)

test_env_set PORTTA_LOG_LEVEL "$TARGET_LOG_LEVEL" >/dev/null
docker start -a "$APPLIER" >/dev/null 2>&1
APPLY_EXIT=$(docker inspect "$APPLIER" --format '{{.State.ExitCode}}')

it "the apply succeeds"
assert_eq "0" "$APPLY_EXIT"

it "Traefik now runs with the saved value"
assert_eq "$TARGET_LOG_LEVEL" "$(traefik_log_level)"

it "because its container was replaced"
assert_ne "$TRAEFIK_BEFORE" "$(docker inspect portta-traefik-1 --format '{{.Id}}' 2>/dev/null)"

it "the applier survived the up it ran, so its exit code can be read"
assert_eq "$APPLIER" "$(test_gateway_container apply)"
assert_eq "exited" "$(test_container_state "$APPLIER")"

it "and a consumer container was not touched"
# ADR 0001. This is the assertion that matters most.
assert_eq "$DEMO_BEFORE" "$(docker inspect demo-a-web-1 --format '{{.Id}}' 2>/dev/null)"

describe "it does not exist unless it is asked for"

it "turning it off removes it"
test_env_set PORTTA_LOG_LEVEL "$ORIGINAL_LOG_LEVEL" >/dev/null
test_env_set PORTTA_APPLY false >/dev/null
"$GW" up local >/dev/null 2>&1
assert_eq "" "$(test_gateway_container apply)"
[ "$ORIGINAL_APPLY" = false ] && RESTORED=1

t_summary
