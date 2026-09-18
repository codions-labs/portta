#!/bin/bash
set -euo pipefail

key=/tmp/claude-code.asc
keyring=/etc/apt/keyrings/claude-code.asc
fingerprint=31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE

install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://downloads.claude.ai/keys/claude-code.asc -o "$key"
actual_fingerprint="$(gpg --show-keys --with-colons "$key" | awk -F: '$1 == "fpr" { print $10; exit }')"
test "$actual_fingerprint" = "$fingerprint"
install -m 0644 "$key" "$keyring"
echo "deb [signed-by=$keyring] https://downloads.claude.ai/claude-code/apt/stable stable main" \
  > /etc/apt/sources.list.d/claude-code.list
apt-get update
apt-get install -y --no-install-recommends claude-code
rm -f "$key"
rm -rf /var/lib/apt/lists/*
