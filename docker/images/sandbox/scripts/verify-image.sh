#!/bin/bash
set -euo pipefail

manifest="${PORTTA_FLOW_SANDBOX_MANIFEST:-/etc/portta-sandbox/manifest.json}"
test -s "$manifest"

for command in node npm git gh aws codex claude opencode pi playwright mmdc asciinema; do
  command -v "$command" >/dev/null
done

jq -e '
  . as $manifest |
  $manifest.schemaVersion == 1 and
  ($manifest.sandbox.version | length > 0) and
  ($manifest.sandbox.platform | startswith("linux/")) and
  (["node", "npm", "git", "gh", "aws", "codex", "claude", "opencode", "pi", "playwright", "chromium", "mermaid", "asciinema"] |
    all(. as $tool | $manifest.tools[$tool] | type == "string" and length > 0))
' "$manifest" >/dev/null
