#!/bin/bash
set -euo pipefail

install_github_cli() {
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg
  chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list
  apt-get update
  apt-get install -y --no-install-recommends gh
  rm -rf /var/lib/apt/lists/*
}

install_aws_cli() {
  case "${TARGETARCH:?TARGETARCH is required}" in
    amd64|arm64) ;;
    *) echo "Unsupported AWS CLI architecture: ${TARGETARCH}" >&2; return 1 ;;
  esac

  curl -fsSL https://awscli.amazonaws.com/v2/install.sh -o /tmp/aws-cli-install.sh
  chmod 0755 /tmp/aws-cli-install.sh
  /tmp/aws-cli-install.sh --system
  rm -f /tmp/aws-cli-install.sh
}

install_node_tools() {
  PUPPETEER_SKIP_DOWNLOAD=true \
    npm install --global --no-audit --no-fund @playwright/test@latest @mermaid-js/mermaid-cli@latest
  playwright install chromium --with-deps --only-shell
  npm cache clean --force

  chromium="$(find "$PLAYWRIGHT_BROWSERS_PATH" -type f \( -name chrome-headless-shell -o -name headless_shell \) -executable | head -n 1)"
  test -n "$chromium"
  printf '{"args":["--no-sandbox","--disable-setuid-sandbox"],"executablePath":"%s"}\n' "$chromium" \
    > /root/.puppeteerrc.json
}

install_github_cli
install_aws_cli
/usr/local/lib/portta-sandbox/agents/claude-code.sh
/usr/local/lib/portta-sandbox/agents/codex.sh
/usr/local/lib/portta-sandbox/agents/opencode.sh
/usr/local/lib/portta-sandbox/agents/pi.sh
install_node_tools
