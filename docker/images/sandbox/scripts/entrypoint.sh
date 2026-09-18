#!/bin/bash
set -euo pipefail

if [ -f "$PWD/package-lock.json" ]; then
  npm ci 2>/dev/null || npm install
fi

exec "$@"
