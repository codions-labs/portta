#!/usr/bin/env bash
# ============================================================================
# Workspace boundaries: who may import whom
# ============================================================================
# The monorepo's shape is a decision, and a decision nothing enforces is a
# suggestion. An import that crosses the wrong way does not fail to compile —
# npm workspaces resolve every package from the same node_modules — so it is
# caught here instead, in milliseconds, against the map in docs/development/monorepo.md.
#
# The permitted edges:
#
#   contracts -> core
#   mcp       -> contracts
#   db        -> core
#   auth      -> core, contracts, db
#   server    -> core, contracts, db, auth, mcp
#   web       -> core, contracts, db, auth, server
#   host      -> core, contracts
#   cli       -> core, contracts, host, mcp
#   apps/auth -> core
#
# Only `src/` is checked. A package's build scripts and its suites may reach
# further — packages/contracts generates its OpenAPI document from the server's
# routes — because nothing a consumer loads follows them.
#
# A missing optional directory contributes no imports; every present workspace
# is checked against the same map.
# ============================================================================
set -uo pipefail

PORTTA_TEST_DIR=$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
. "$PORTTA_TEST_DIR/lib/assert.sh"
PORTTA_ROOT=$(cd -P "$PORTTA_TEST_DIR/.." && pwd); export PORTTA_ROOT
cd "$PORTTA_ROOT" || exit 1

# Every workspace import in one or more directories' source (space separated).
# `from 'portta-…'` and `import('portta-…')` both count; a comment naming a
# package does not, which is why the quote is part of the pattern.
imports() {
  local dir found=""
  for dir in $1; do
    [ -d "$dir" ] || continue
    found="$found
$(grep -rnoE "(from|import\()\s*'portta-[a-z-]*(/[a-z-]+)?'" "$dir" \
      --include='*.ts' --include='*.tsx' 2>/dev/null | grep -oE "portta-[a-z-]*" || true)"
  done
  printf '%s\n' "$found" | grep . | sort -u || true
}

# What is left after removing the packages a directory is allowed to import.
forbidden() {
  local dir="$1"; shift
  local allowed="$*"
  local found
  found=$(imports "$dir")
  [ -n "$found" ] || return 0
  local package
  for package in $found; do
    case " $allowed " in
      *" $package "*) ;;
      *) printf '%s\n' "$package" ;;
    esac
  done
}

describe "a package imports only what its layer allows"

# The shared derivations run on the host, in the panel and in the CLI. A
# dependency on anything else in the monorepo would make one of the three
# impossible to build.
it "portta-core imports nothing from the monorepo"
assert_eq "" "$(forbidden packages/core/src)"

# The contract is what the browser, the CLI and a future SDK compile against.
# It may name the vocabulary in core; it may not know a database exists.
it "portta-contracts imports only portta-core"
assert_eq "" "$(forbidden packages/contracts/src portta-core)"

# The MCP tools are one call to the panel each, served by the CLI over stdio
# and by the panel over HTTP. They name the contract and nothing that would
# tie them to either process.
it "portta-mcp imports only portta-contracts"
assert_eq "" "$(forbidden packages/mcp/src portta-contracts)"

# Persistence holds no business rule, so it has nothing to ask auth or the
# services for.
it "portta-db imports only portta-core"
assert_eq "" "$(forbidden packages/db/src portta-core)"

# Authentication knows the schema it stores sessions in and the shapes it
# answers with, and nothing about Docker, projects or environments.
it "portta-auth-core imports only portta-core, portta-contracts and portta-db"
assert_eq "" "$(forbidden packages/auth/src portta-core portta-db portta-contracts)"

# The CLI runs on the host, against a panel it reaches over HTTP. It never
# opens the SQLite database the panel owns, which is why it cannot import the
# packages that could.
it "portta the CLI never imports the database, auth or the server"
assert_eq "" "$(forbidden packages/cli/src portta-core portta-contracts portta-host portta-mcp)"

# The host daemon runs beside the CLI, on the host, and reaches the panel's
# data only through the panel. It is bundled into the CLI, so it may not need
# anything the CLI could not ship either.
it "portta-host imports only portta-core and portta-contracts"
assert_eq "" "$(forbidden packages/host/src portta-core portta-contracts)"

# The ForwardAuth service protects project hostnames and shares. It is not the
# panel and must not grow into it.
it "the ForwardAuth service imports only portta-core"
assert_eq "" "$(forbidden apps/auth/src portta-core)"

# The panel composes; it is the one place allowed to reach the server, because
# a Server Component calls a service directly rather than fetching its own API.
it "the panel composes the packages below it, and nothing outside them"
assert_eq "" "$(forbidden "apps/web/app apps/web/components apps/web/lib apps/web/modules apps/web/server" portta-core portta-contracts portta-db portta-auth-core portta-server)"

describe "the boundary holds in the other direction too"

# A package below the panel that reached back up would make the panel
# unbuildable in isolation and the server untestable without a UI.
it "nothing below the panel imports the panel"
assert_eq "" "$(grep -rn "from 'portta-web'" packages --include='*.ts' --include='*.tsx' 2>/dev/null || true)"

# Relative paths are the loophole the package names close: `../../../apps/web`
# resolves perfectly well and answers to none of the rules above.
it "no package reaches into another by relative path"
assert_eq "" "$(grep -rnE "from '(\.\./){2,}(apps|packages)/" packages apps --include='*.ts' --include='*.tsx' 2>/dev/null || true)"
