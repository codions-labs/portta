#!/usr/bin/env bash
# ============================================================================
# E2E: optional local HTTPS
# ============================================================================
# Issues a local CA and wildcard certificate, serves a demo over HTTPS, checks
# the chain validates against that CA, then puts the gateway back on plain HTTP.
#
# Trusting the CA in the OS trust store is a privileged host action the gateway
# never performs, so this suite verifies the chain explicitly instead.
# ============================================================================
set -uo pipefail

node "$(dirname "$0")/../lib/require-disposable.mjs" || exit 1

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
. "$PORTTA_TEST_DIR/lib/runtime.sh"
test_load_runtime

GW="$PORTTA_ROOT/bin/portta"
CA="$PORTTA_ROOT/config/tls/portta-ca.crt"

test_require_docker || { echo "Docker unavailable: E2E incomplete"; exit 1; }
test_have openssl || { echo "openssl unavailable: E2E incomplete"; exit 1; }

# Remember how TLS was configured so the suite leaves the host as it found it.
ORIG_TLS="${TLS_ENABLED:-false}"
HAD_CA=0; [ -f "$CA" ] && HAD_CA=1

cleanup() {
  ( cd "$(test_example_dir demo-a)" && docker compose \
      -f compose.yaml -f compose.portta.yaml down -v ) >/dev/null 2>&1
  test_env_set TLS_ENABLED "$ORIG_TLS" >/dev/null 2>&1
  if [ "$HAD_CA" = "0" ]; then
    rm -f "$PORTTA_ROOT/config/tls/portta-ca."* "$PORTTA_ROOT/config/tls/wildcard."* \
          "$PORTTA_ROOT/config/traefik/dynamic/local-tls.yaml"
  fi
  TLS_ENABLED="$ORIG_TLS" TLS_MODE=local "$GW" up local >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

describe "issuing a local certificate"
it "tls init succeeds"; assert_success "$GW" tls init
it "the CA certificate exists"; assert_success test -f "$CA"
it "the wildcard certificate exists"; assert_success test -f "$PORTTA_ROOT/config/tls/wildcard.crt"
it "the CA private key is owner-only"
assert_eq "-rw-------" "$(ls -l "$PORTTA_ROOT/config/tls/portta-ca.key" | cut -c1-10)"
it "no key material is tracked by git"
assert_eq "" "$(cd "$PORTTA_ROOT" && git ls-files config/tls | grep -v gitkeep || true)"

it "the certificate covers the wildcard"
assert_contains "$(openssl x509 -noout -text -in "$PORTTA_ROOT/config/tls/wildcard.crt" 2>/dev/null)" "DNS:*.localhost"

describe "serving over HTTPS"
# Drop the cached test value so the CLI reads what `tls init` wrote.
unset TLS_ENABLED TLS_MODE
"$GW" up local >/dev/null 2>&1
( cd "$(test_example_dir demo-a)" && docker compose \
    -f compose.yaml -f compose.portta.yaml up -d --wait --wait-timeout 120 ) >/dev/null 2>&1
test_wait_until 30 test_route_is https://demo-a-web.localhost/ 200

it "the chain validates against the generated CA"
assert_contains "$(echo | openssl s_client -connect "127.0.0.1:${PORTTA_HTTPS_PORT}" \
  -servername demo-a-web.localhost -CAfile "$CA" 2>/dev/null)" "Verify return code: 0 (ok)"

it "the application is actually served over TLS"
assert_contains "$(curl -sk --max-time 10 \
  --resolve "demo-a-web.localhost:${PORTTA_HTTPS_PORT}:127.0.0.1" \
  https://demo-a-web.localhost/ 2>/dev/null)" "demo-a-web"

it "plain HTTP redirects to the HTTPS URL"
assert_eq "302 https://demo-a-web.localhost/" "$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --max-time 10 \
  --resolve "demo-a-web.localhost:${PORTTA_HTTP_PORT}:127.0.0.1" \
  http://demo-a-web.localhost/)"

t_summary
