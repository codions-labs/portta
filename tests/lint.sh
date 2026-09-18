#!/usr/bin/env bash
# Static integration checks.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
FAILED=0
bold() { printf '%s\n' "$1"; }
bold "== shell lint =="
if command -v shellcheck >/dev/null 2>&1; then
  # Linting is a developer convenience here, never a runtime dependency:
  # when the tool is absent the suite says so instead of quietly passing.
  files=$(find scripts tests -type f -name '*.sh' | sort)
  # shellcheck disable=SC2086  # deliberate word splitting over the file list
  if shellcheck -S warning -x $files; then
    echo "  ok  $(printf '%s\n' "$files" | wc -l | tr -d ' ') files clean"
  else
    echo "  FAIL shellcheck reported problems"; FAILED=1
  fi
else
  echo "  FAIL shellcheck not installed (brew install shellcheck)"; FAILED=1
fi

bold "== executable bits =="
if [ -x bin/portta ]; then echo "  ok  bin/portta is executable"
else echo "  FAIL not executable: bin/portta"; FAILED=1; fi

bold "== compose validation =="
if docker compose version >/dev/null 2>&1; then
  # Check that each compose file is individually parseable, so
  # a syntax error is reported against the file that has it.
  # Some overlays are fragments that only make sense on top of another one
  # (the dashboard variant extends the Tailscale attachment), so try the
  # progressively larger combinations before calling a file broken.
  # --project-directory mirrors what the CLI does: it anchors the relative
  # paths in the overlays at the repository root, not at docker/compose/.
  for f in docker/compose/compose.yaml docker/compose/*/*.yaml; do
    if docker compose --project-directory . -f "$f" config --quiet >/dev/null 2>&1 \
       || docker compose --project-directory . \
            -f docker/compose/compose.yaml -f "$f" config --quiet >/dev/null 2>&1 \
       || TS_AUTHKEY=x docker compose --project-directory . \
            -f docker/compose/compose.yaml -f docker/compose/attach/tailscale.yaml \
            -f "$f" config --quiet >/dev/null 2>&1 \
       || docker compose --project-directory . \
            -f docker/compose/compose.yaml -f docker/compose/attach/host.yaml \
            -f docker/compose/features/web.yaml -f "$f" config --quiet >/dev/null 2>&1; then
      echo "  ok  $f parses"
    else
      echo "  FAIL $f does not parse"; FAILED=1
    fi
  done
  for d in tests/fixtures/examples/portta-demo-a tests/fixtures/examples/portta-demo-b; do
    if ( cd "$d" && docker compose -f compose.yaml -f compose.portta.yaml config --quiet ); then
      echo "  ok  $d config is valid"
    else
      echo "  FAIL $d config is invalid"; FAILED=1
    fi
  done
else
  echo "  FAIL docker compose unavailable"; FAILED=1
fi

bold "== no pinned-to-latest images =="
# A floating tag turns an unrelated upstream release into an outage.
floating=$(grep -rnE '^\s*image:\s*\S+(:latest)?\s*$' docker/compose/compose.yaml docker/compose/*/*.yaml tests/fixtures/examples/*/compose*.yaml \
  | grep -vE 'image:\s*\S+:[A-Za-z0-9]|\$\{PORTTA_VERSION\}' || true)
if [ -n "$floating" ]; then
  echo "  FAIL images without an explicit tag:"; printf '%s\n' "$floating" | sed 's/^/       /'; FAILED=1
else
  echo "  ok  every image pins an explicit version"
fi

bold "== documentation links =="
if [ "${PORTTA_SKIP_DOCS_CHECK:-}" = 1 ]; then
  echo "  skip docs:check (no documentation paths in the CI scope)"
else
  npm run docs:check || FAILED=1
fi

bold "== no secrets committed =="
leaked=$(git ls-files -z 2>/dev/null | xargs -0 grep -lE \
  'tskey-(auth|client)-[A-Za-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY-----' 2>/dev/null || true)
if [ -n "$leaked" ]; then
  echo "  FAIL possible secret material in:"; printf '%s\n' "$leaked" | sed 's/^/       /'; FAILED=1
else
  echo "  ok  no auth keys or private keys tracked"
fi
exit "$FAILED"
